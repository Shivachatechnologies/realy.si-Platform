import { z } from "zod";
import { db, Prisma } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { conflict, invalid, isAppError, notFound } from "@/server/core/errors";
import { updateAsset } from "@/server/modules/assets/service";
import { writeAudit } from "@/server/modules/audit/service";
import { journeyAction } from "@/server/modules/crm/guided";
import { createBudget } from "@/server/modules/finance/transactions";
import { createEntity } from "@/server/modules/graph/service";
import { createCampaign } from "@/server/modules/marketing/campaigns";
import { createObjective } from "@/server/modules/objectives/service";
import { getStrategy, saveStrategy } from "@/server/modules/objectives/goals";
import { createProjectMilestone, createWorkProject } from "@/server/modules/work/projects";
import { createWorkTask } from "@/server/modules/work/tasks";
import { createSite, setupDefaults, upsertDraftPages } from "@/server/modules/sites/service";
import { pagesFromStructure, siteT } from "@/server/modules/sites/templates";
import { requirePermission } from "@/server/modules/rbac/service";
import { companyChain } from "@/server/modules/rbac/scope";
import { installPart } from "./engine";
import { saveProgress } from "./journey";
import { forecastSchema, KIT_ACTIONS, kitDef, marketingSchema, namesSchema, personasSchema, positioningSchema, pricingSchema, roadmapSchema, salesSchema, websiteSchema, type KitAction } from "./kit-defs";
import type { KitActionRecord } from "./kit";
import { chooseCompanyName } from "./service";
import { workforcePlanSchema } from "./steps";

/**
 * "Turn this into action": creates real records from a ready Founder Kit deliverable through the owning modules'
 * services, so their permissions (projects.manage, objectives.manage, marketing.manage, sales.manage, finance.manage,
 * …), validation, audit and events apply exactly as if the founder created them by hand. Nothing is sent, published or
 * paid: campaigns are drafts, the AI workforce goes to the workforce stage for approval. What was created is recorded
 * on the item (so the kit links to it and one-off actions are not repeated by accident).
 */

export const actionInput = z.object({
  action: z.enum(KIT_ACTIONS),
  /** use_name: the chosen name; pin_logo: the asset id. */
  value: z.string().trim().min(1).max(120).optional(),
  /** Repeat a one-off action that was already done (creates the records again). */
  again: z.boolean().default(false),
});

const ONE_OFF: KitAction[] = ["create_project", "create_objectives", "create_campaigns", "create_budgets", "create_products"];
const isoIn = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
const addMonths = (base: Date, months: number) => new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + months, 1));
const money = (v: number) => (Math.round(v * 100) / 100).toFixed(2);

function parse<T extends z.ZodType>(schema: T, data: unknown): z.output<T> {
  const r = schema.safeParse(data);
  if (!r.success) throw invalid("This deliverable's structured part is missing or not valid; regenerate or edit it first", { reason: "builder_kit_invalid_data" });
  return r.data;
}

export async function runKitAction(ctx: RequestContext, organizationId: string, companyId: string, runId: string, key: string, raw: z.input<typeof actionInput>) {
  const input = actionInput.parse(raw);
  const def = kitDef(key);
  if (!def || !z.string().uuid().safeParse(runId).success) throw notFound("Founder Kit deliverable");
  if (!def.actions.includes(input.action)) throw invalid("This action is not available for this deliverable", { reason: "builder_kit_action_unavailable" });
  // Each record is created by its own module's service with that module's permission; reading the kit needs
  // companies.read, and changing the company's own plan (workforce, name) companies.manage.
  await requirePermission(ctx, ["use_workforce", "use_name"].includes(input.action) ? "companies.manage" : "companies.read", await companyChain(db(), organizationId, companyId));
  const run = await db().builderRun.findFirst({ where: { id: runId, organizationId, companyId }, include: { company: { select: { name: true, baseCurrency: true } } } });
  if (!run) throw notFound("Builder run");
  const item = await db().builderKitItem.findFirst({ where: { runId, organizationId, companyId, key } });
  if (!item) throw notFound("Founder Kit deliverable");
  if (item.status !== "READY") throw conflict("This deliverable is not ready yet", { reason: "builder_kit_not_ready" });
  const records = (Array.isArray(item.actions) ? item.actions : []) as KitActionRecord[];
  if (ONE_OFF.includes(input.action) && !input.again && records.some((r) => r.action === input.action)) {
    throw conflict("This was already created from the kit", { reason: "builder_kit_action_done" });
  }
  const { organizationId: org } = run;
  const co = companyId;
  const now = new Date().toISOString();
  const out: KitActionRecord[] = [];
  const rec = (kind: string, id: string, label: string, href: string | null) => out.push({ action: input.action, kind, id, label: label.slice(0, 200), href, at: now });

  switch (input.action) {
    case "create_project": {
      const d = parse(roadmapSchema, item.data);
      const last = Math.max(...d.milestones.map((m) => m.dueInDays), ...d.milestones.flatMap((m) => m.tasks.map((t) => t.dueInDays ?? 0)));
      const project = await createWorkProject(ctx, org, co, { name: d.projectName, description: `Launch roadmap from the Founder Kit of ${run.company.name}.`, status: "PLANNED", startDate: isoIn(0), dueDate: isoIn(Math.max(last, 1)) });
      rec("project", project.id, project.name, `/projects/${project.id}`);
      for (const m of d.milestones) {
        const ms = await createProjectMilestone(ctx, org, co, project.id, { title: m.title, description: m.description, dueDate: isoIn(m.dueInDays) });
        for (const t of m.tasks) {
          await createWorkTask(ctx, org, co, { projectId: project.id, milestoneId: ms.id, title: t.title, description: t.description, priority: t.priority, dueDate: isoIn(t.dueInDays ?? m.dueInDays) });
        }
      }
      break;
    }
    case "create_objectives": {
      const d = parse(roadmapSchema, item.data);
      if (!d.objectives.length) throw invalid("The roadmap has no objectives; edit it to add some", { reason: "builder_kit_no_objectives" });
      for (const o of d.objectives) {
        const created = await createObjective(ctx, org, co, { title: o.title, description: o.description, startDate: isoIn(0), targetDate: isoIn(o.targetInDays) });
        rec("objective", created.id, o.title, "/objectives");
      }
      break;
    }
    case "create_campaigns": {
      const d = parse(marketingSchema, item.data);
      for (const c of d.campaigns) {
        const created = await createCampaign(ctx, org, co, {
          name: c.name,
          objective: c.objective.slice(0, 500),
          description: c.description || undefined,
          channels: c.channels,
          budget: c.budget !== undefined ? money(c.budget) : undefined,
          startDate: isoIn(7),
          endDate: isoIn(7 + c.durationDays),
        });
        rec("campaign", created.id, c.name, `/marketing/campaigns/${created.id}`);
      }
      break;
    }
    case "save_icp": {
      const icp = key === "sales_strategy" ? parse(salesSchema, item.data).icp : parse(personasSchema, item.data).icp;
      await journeyAction(ctx, org, co, { action: "icp_save", icp, keepStep: true });
      rec("crm_icp", co, "Ideal customer profile", "/crm/settings");
      break;
    }
    case "save_strategy": {
      const d = parse(positioningSchema, item.data);
      const current = await getStrategy(ctx, org, co);
      await saveStrategy(ctx, org, co, { mission: d.mission, vision: d.vision, values: d.values, pillars: current.pillars.map((p) => ({ id: p.id, title: p.title, description: p.description })) });
      rec("strategy", co, "Mission, vision and values", "/objectives/goals");
      break;
    }
    case "create_budgets": {
      const d = parse(forecastSchema, item.data);
      if (!d.budgets.length) throw invalid("The projection has no budgets; edit it to add some", { reason: "builder_kit_no_budgets" });
      const start = addMonths(new Date(), 0);
      for (const b of d.budgets) {
        const end = addMonths(start, b.months);
        end.setUTCDate(end.getUTCDate() - 1);
        const created = await createBudget(ctx, org, co, { name: b.name, periodStart: start.toISOString().slice(0, 10), periodEnd: end.toISOString().slice(0, 10), amount: money(b.amount) });
        rec("budget", created.id, b.name, "/finance/budgets");
      }
      break;
    }
    case "create_products": {
      const d = parse(pricingSchema, item.data);
      for (const t of d.tiers) {
        try {
          const e = await createEntity(ctx, org, co, { kind: "PRODUCT", name: t.name, description: [t.audience, `Price: ${t.price} ${d.currency} / ${t.interval.replace("_", " ")}`, ...t.features.map((f) => `• ${f}`)].join("\n").slice(0, 2000) });
          rec("product", e.id, t.name, `/graph/${e.id}`);
        } catch (err) {
          if (!(isAppError(err) && err.code === "conflict")) throw err;
        }
      }
      if (!out.length) throw conflict("These products already exist", { reason: "builder_kit_products_exist" });
      break;
    }
    case "use_workforce": {
      const d = parse(workforcePlanSchema, item.data);
      if (run.journey && ctx.actor.type === "USER" && ctx.actor.id === run.createdById) {
        await saveProgress(ctx, { draft: { workforce: { runId, value: d } } });
        rec("workforce_draft", runId, "AI workforce plan", "/onboarding?stage=workforce");
      } else {
        // Outside the journey the plan is hired through the marketplace installer (the founder's workforce.manage applies).
        await installPart(run, { aiEmployees: d.team.map((m) => ({ profile: m.profile, name: m.name, description: [m.title, ...m.responsibilities].filter(Boolean).join(" · ").slice(0, 2000) })) }, ctx);
        rec("ai_employees", runId, `AI employees (${d.team.length})`, "/workforce");
      }
      break;
    }
    case "use_name": {
      const d = parse(namesSchema, item.data);
      const name = input.value?.trim();
      if (!name) throw invalid("Choose a name", { reason: "builder_name_required", issues: [{ path: "value", message: "Required" }] });
      if (!d.names.some((n) => n.name === name)) throw invalid("Choose one of the proposed names", { reason: "builder_kit_unknown_name" });
      await chooseCompanyName(ctx, org, co, runId, name);
      rec("company_name", co, name, "/company");
      break;
    }
    case "create_site": {
      // A real website (sites module, marketing.manage + plan feature): the structure becomes DRAFT pages — nothing is
      // published. Without a site one is created first (brand colours, fonts and logo from the brand kit).
      const d = parse(websiteSchema, item.data);
      const existing = await db().site.findFirst({ where: { organizationId: org, companyId: co }, select: { id: true, name: true, locale: true } });
      if (!existing) {
        const defaults = await setupDefaults(ctx, org, co);
        const created = await createSite(ctx, org, co, { name: defaults.name, slug: defaults.slug, locale: defaults.locale as "en-US", theme: defaults.theme, start: "structure" });
        rec("site", created.id, defaults.name, "/website/pages");
      } else {
        const products = await db().product.findMany({ where: { organizationId: org, companyId: co, archivedAt: null }, take: 6, select: { id: true, name: true } });
        const drafts = pagesFromStructure(await siteT(existing.locale), { companyName: existing.name, products }, d);
        const r = await upsertDraftPages(ctx, org, co, drafts);
        rec("site", existing.id, `${existing.name} (${r.pages.length})`, "/website/pages");
      }
      break;
    }
    case "pin_logo": {
      const ids = ((item.data as { assetIds?: string[] } | null)?.assetIds ?? []).filter((x) => typeof x === "string");
      if (!input.value || !ids.includes(input.value)) throw invalid("Choose one of the generated logos", { reason: "builder_kit_unknown_logo" });
      await updateAsset(ctx, org, co, input.value, { scopeType: "BRAND", scopeId: null, pinned: true, title: `Logo — ${run.company.name}`.slice(0, 160) });
      rec("brand_logo", input.value, "Brand logo", "/assets");
      break;
    }
  }

  const kept = ONE_OFF.includes(input.action) ? records : records.filter((r) => r.action !== input.action);
  await db().builderKitItem.update({ where: { id: item.id }, data: { actions: [...kept, ...out] as unknown as Prisma.InputJsonValue } });
  await writeAudit(db(), ctx, { category: "TENANT", organizationId: org, action: "builder.kit.action", resourceType: "builder_kit_item", resourceId: item.id, newValue: { key, action: input.action, records: out.map((r) => ({ kind: r.kind, id: r.id })) } });
  return { records: out };
}
