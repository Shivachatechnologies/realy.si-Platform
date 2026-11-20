import { z } from "zod";
import { db, Prisma, transaction } from "@/server/core/db";
import { env } from "@/server/core/env";
import { userContext, type RequestContext } from "@/server/core/context";
import { AppError, conflict, invalid, isAppError, notFound } from "@/server/core/errors";
import { logger } from "@/server/core/logger";
import { agentModel, aiRefusal, aiRefusalMessage } from "@/server/core/platform-controls";
import { createTask } from "@/server/modules/agents/service";
import { aiConfigured } from "@/server/modules/agents/runtime";
import { imageProviderStatus } from "@/server/modules/assets/service";
import { writeAudit } from "@/server/modules/audit/service";
import { deleteDocument, ingestDocument } from "@/server/modules/brain/service";
import { webSearch } from "@/server/modules/integrations/services/research";
import { generateImage } from "@/server/modules/integrations/services/images";
import { notifyUsers } from "@/server/modules/notifications/service";
import { extractJson } from "@/server/modules/objectives/plan";
import { requirePermission } from "@/server/modules/rbac/service";
import { companyChain } from "@/server/modules/rbac/scope";
import { briefText, parseBrief } from "./brief";
import { assertFeature } from "@/server/modules/entitlements/service";
import { KIT, KIT_KEYS, kitDef, positioningSchema, type KitDef, type KitKey } from "./kit-defs";

/**
 * Founder Kit engine: creates the kit's items for a builder run, starts each AI deliverable as an agent task as soon as
 * the deliverables it builds on are ready, and turns a finished task into the saved deliverable (Markdown + validated
 * JSON + Company Brain document). The logo is generated with the integrations image service and stored in the assets
 * module. Every transition is a conditional update, so the periodic job, the task-finished event and page polls can all
 * call advanceKit concurrently. Work runs as the founder who started the run (their permissions, AI budget and the
 * platform kill switches apply through createTask).
 */

export const KIT_SUBJECT = "builder_kit_item";
const MAX_PARALLEL = 4;
const isUuid = (v: string) => z.string().uuid().safeParse(v).success;
const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err)).slice(0, 1000);
const errorReason = (err: unknown) => (isAppError(err) && typeof err.details?.reason === "string" ? err.details.reason : isAppError(err) ? err.code : "internal_error");
/** Errors that stop every other item too (no AI provider, budget, kill switch). */
const BLOCKING = ["not_configured", "not_available", "forbidden"];

type RunRow = Prisma.BuilderRunGetPayload<{ include: { company: { select: { name: true; baseCurrency: true } } } }>;
type ItemRow = Prisma.BuilderKitItemGetPayload<object>;

const founderCtx = (run: { createdById: string }): RequestContext => userContext(run.createdById, { requestId: `kit_${Date.now().toString(36)}` });
const label = (key: string) => key.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

async function authorize(ctx: RequestContext, organizationId: string, companyId: string, permission: "companies.read" | "companies.manage") {
  await requirePermission(ctx, permission, await companyChain(db(), organizationId, companyId));
}

async function loadRun(organizationId: string, companyId: string, runId: string) {
  if (!isUuid(runId)) throw notFound("Builder run");
  const run = await db().builderRun.findFirst({ where: { id: runId, organizationId, companyId }, include: { company: { select: { name: true, baseCurrency: true } } } });
  if (!run) throw notFound("Builder run");
  return run;
}

// ───────────── Research (sourced) ─────────────

function researchQueries(run: RunRow, kind: "market" | "competitors"): string[] {
  const b = parseBrief(run.brief);
  const topic = (b.offering || b.idea || b.industry || "").replace(/\s+/g, " ").trim().slice(0, 140);
  if (!topic) return [];
  const where = b.targetMarket?.slice(0, 60) || b.targetMarketCodes.slice(0, 3).join(" ") || b.countryCode || "";
  return kind === "market"
    ? [`${topic} market size ${where}`.trim(), `${topic} industry trends ${new Date().getUTCFullYear()}`.trim(), `${topic} customer demand survey ${where}`.trim()]
    : [`${topic} competitors ${where}`.trim(), `best ${topic} alternatives`.trim(), `${topic} pricing plans`.trim()];
}

async function research(run: RunRow, kind: "market" | "competitors") {
  const queries = researchQueries(run, kind);
  if (!queries.length) return { sources: [], research: "no_topic" };
  const outcomes = await Promise.all(queries.map((q) => webSearch(run.organizationId, run.companyId, q, { maxResults: 5 })));
  if (outcomes.every((o) => !o.ok && o.code === "not_connected")) return { sources: [], research: "not_connected" };
  const seen = new Set<string>();
  const sources: { title: string; url: string; snippet?: string }[] = [];
  for (const o of outcomes) {
    if (!o.ok) continue;
    for (const r of o.data.results) {
      if (seen.has(r.url) || sources.length >= 15) continue;
      seen.add(r.url);
      sources.push({ title: (r.title || r.url).slice(0, 200), url: r.url.slice(0, 2000), snippet: r.snippet?.slice(0, 400) });
    }
  }
  return { sources, research: sources.length ? `done:${outcomes.find((o) => o.ok)?.providerId ?? "provider"}` : "failed" };
}

// ───────────── Instructions ─────────────

function depsContext(def: KitDef, items: ItemRow[]): string {
  const deps = def.deps.map((k) => items.find((i) => i.key === k)).filter((i): i is ItemRow => !!i?.content);
  if (!deps.length) return "";
  const per = Math.floor(3200 / deps.length);
  return ["The kit deliverables this one builds on (summaries; full versions are in Company Brain, tag \"founder-kit\"):", ...deps.map((d) => `### ${label(d.key)}\n${d.content!.slice(0, per)}`)].join("\n\n");
}

function instructionsFor(run: RunRow, item: ItemRow, def: KitDef, items: ItemRow[], sources: { title: string; url: string; snippet?: string }[] | null, researchState: string | null) {
  const brief = parseBrief(run.brief);
  const parts = [
    `You are preparing one deliverable of the Founder Kit for a first-time, non-technical founder: "${label(def.key)}". Write so a beginner understands it: plain words, short sections, concrete next steps.`,
    `Founder's brief:\n${briefText(brief, run.company.name)}\nCompany base currency: ${run.company.baseCurrency}`,
    `Your task: ${def.prompt}`,
    item.feedback ? `The founder reviewed the previous version and asked for these changes: ${item.feedback}` : "",
    depsContext(def, items),
    sources?.length
      ? `Live web research results (cite them as [n] next to every claim that uses them, and end with a "Sources" list of the ones you used):\n${sources.map((s, i) => `[${i + 1}] ${s.title} — ${s.url}${s.snippet ? `\n    ${s.snippet}` : ""}`).join("\n")}`
      : def.research
        ? `No live web research is available${researchState === "not_connected" ? " (no research provider is connected)" : ""}. Use general knowledge only, mark every figure as an estimate with its assumption, and list what must be verified with real research.`
        : "",
    `Write the deliverable in Markdown with clear headings. Label assumptions as "Assumption:". Never present invented figures, customers, competitors or results as facts.`,
  ];
  if (def.schema && def.shape) {
    parts.push(
      `After the Markdown, end your answer with exactly one fenced \`\`\`json block containing ONLY a JSON object of this shape (no comments, no trailing commas): ${def.shape}`,
      `Do not call tools that create or change records: the founder decides what to turn into records.`,
    );
  }
  return parts.filter(Boolean).join("\n\n").slice(0, 7900);
}

// ───────────── Transitions ─────────────

async function fail(item: ItemRow, code: string, message: string, issues: string[] = []) {
  await db().builderKitItem.update({ where: { id: item.id }, data: { status: "FAILED", errorCode: code.slice(0, 80), errorMessage: message.slice(0, 1000), errorIssues: issues.slice(0, 20) } });
}

async function startAi(run: RunRow, item: ItemRow, def: KitDef, items: ItemRow[]) {
  const { count } = await db().builderKitItem.updateMany({ where: { id: item.id, status: "PENDING" }, data: { status: "GENERATING", attempts: { increment: 1 }, errorCode: null, errorMessage: null, errorIssues: [], agentTaskId: null } });
  if (!count) return "busy" as const;
  try {
    let sources: { title: string; url: string; snippet?: string }[] | null = null;
    let state: string | null = null;
    if (def.research) {
      const r = await research(run, def.research).catch((err) => ({ sources: [], research: `failed:${errorText(err).slice(0, 80)}` }));
      sources = r.sources;
      state = r.research;
      await db().builderKitItem.update({ where: { id: item.id }, data: { data: { sources: r.sources, research: r.research } } });
    }
    const task = await createTask(founderCtx(run), run.organizationId, run.companyId, {
      profile: def.profile,
      title: `Founder Kit — ${label(def.key)}: ${run.company.name}`.slice(0, 200),
      instructions: instructionsFor(run, item, def, items, sources, state),
      subject: { type: KIT_SUBJECT, id: item.id },
    });
    await db().builderKitItem.update({ where: { id: item.id }, data: { agentTaskId: task.id } });
    return "started" as const;
  } catch (err) {
    logger.warn({ runId: run.id, item: item.key, err: errorText(err) }, "founder kit item could not start");
    await fail(item, errorReason(err), errorText(err));
    return isAppError(err) && BLOCKING.includes(err.code) ? ("blocked" as const) : ("failed" as const);
  }
}

function logoPrompt(run: RunRow, items: ItemRow[]) {
  const pos = positioningSchema.safeParse(items.find((i) => i.key === "brand_positioning")?.data);
  const name = parseBrief(run.brief).name ?? run.company.name;
  const p = pos.success ? pos.data : null;
  return [
    `A professional, minimal logo symbol for a company called "${name}"`,
    p ? `in the category ${p.category}; brand idea: ${p.keyBenefit}` : "",
    p?.visual.style ? `Style: ${p.visual.style}` : "Style: modern, geometric, flat vector",
    p?.visual.colors.length ? `Colours: ${p.visual.colors.join(", ")}` : "",
    "Simple flat vector mark, centred on a plain white background, crisp edges, works small as an app icon, no mockup, no photo, no extra text.",
  ]
    .filter(Boolean)
    .join(". ")
    .slice(0, 1500);
}

/** The logo: integrations image generation → stored as BRAND visual assets (assets module). */
async function generateLogo(run: RunRow, item: ItemRow, items: ItemRow[]) {
  const { organizationId: org, companyId: co } = run;
  const refusal = await aiRefusal(org, { model: await agentModel(env().AGENT_MODEL) });
  if (refusal) {
    await fail(item, refusal, aiRefusalMessage(refusal));
    return;
  }
  const providers = await imageProviderStatus(org, co);
  if (!providers.any) {
    await db().builderKitItem.update({ where: { id: item.id }, data: { status: "NEEDS_SETUP", errorCode: "assets_image_not_connected", errorMessage: null } });
    return;
  }
  const { count } = await db().builderKitItem.updateMany({ where: { id: item.id, status: "PENDING" }, data: { status: "GENERATING", attempts: { increment: 1 }, errorCode: null, errorMessage: null, errorIssues: [] } });
  if (!count) return;
  const prompt = logoPrompt(run, items);
  const result = await generateImage(org, co, { prompt, size: "1024x1024", n: 3 });
  if (!result.ok) {
    if (result.code === "not_connected") await db().builderKitItem.update({ where: { id: item.id }, data: { status: "NEEDS_SETUP", errorCode: "assets_image_not_connected" } });
    else await fail(item, result.code === "rate_limited" ? "assets_provider_rate_limited" : "assets_provider_failed", result.error);
    return;
  }
  const ctx = founderCtx(run);
  const assetIds = await transaction(async (tx) => {
    const ids: string[] = [];
    for (const img of result.data.images) {
      const a = await tx.visualAsset.create({
        data: {
          organizationId: org,
          companyId: co,
          scopeType: "BRAND",
          scopeId: null,
          kind: "IMAGE",
          source: "GENERATED",
          title: `Logo concept — ${run.company.name}`.slice(0, 160),
          storageRef: img.ref,
          contentType: img.contentType,
          sizeBytes: img.size,
          prompt,
          stylePreset: "illustration",
          aspectRatio: "1:1",
          width: 1024,
          height: 1024,
          provider: result.providerId,
          model: result.data.model,
          createdById: run.createdById,
        },
        select: { id: true },
      });
      ids.push(a.id);
    }
    await writeAudit(tx, ctx, { category: "TENANT", organizationId: org, action: "assets.generated", resourceType: "visual_asset", resourceId: ids[0] ?? null, newValue: { count: ids.length, scopeType: "BRAND", provider: result.providerId, model: result.data.model, source: "founder_kit" } });
    return ids;
  });
  const content = `# Logo concepts\n\n${assetIds.length} logo concepts were generated with ${result.providerId ?? "the image provider"} (${result.data.model}). Choose one to make it the brand logo, or regenerate with feedback.\n\nPrompt used: ${prompt}`;
  await db().builderKitItem.update({
    where: { id: item.id },
    data: { status: "READY", content, data: { assetIds, provider: result.providerId, model: result.data.model, prompt }, generatedAt: new Date(), edited: false, approvedAt: null, approvedById: null },
  });
}

function markdownPart(output: string, json: string | null) {
  let doc = output.replace(/```json\s*[\s\S]*?```/gi, "");
  if (json && doc.includes(json)) doc = doc.replace(json, "");
  return doc.trim();
}

const sourceList = (data: unknown) => {
  const d = data as { sources?: { title: string; url: string }[] } | null;
  return d?.sources?.length ? `\n\n## Research sources\n${d.sources.map((s, i) => `${i + 1}. [${s.title.replace(/[[\]]/g, "")}](${s.url})`).join("\n")}` : "";
};

async function saveToBrain(run: RunRow, ctx: RequestContext, item: { key: string; brainDocumentId: string | null }, content: string, def: KitDef): Promise<string | null> {
  if (content.length < 40) return item.brainDocumentId;
  const department = await db().department.findFirst({ where: { organizationId: run.organizationId, companyId: run.companyId, name: { equals: def.department, mode: "insensitive" } }, select: { id: true } });
  let id: string | null = null;
  try {
    const doc = await ingestDocument(ctx, run.organizationId, run.companyId, {
      title: `${run.company.name} — Founder Kit: ${label(item.key)}`.slice(0, 200),
      filename: `founder-kit-${item.key.replace(/_/g, "-")}.md`,
      content: content.slice(0, 900_000),
      departmentId: department?.id ?? null,
      tags: ["builder", "founder-kit", item.key.replace(/_/g, "-")],
    });
    id = doc.id;
  } catch (err) {
    if (isAppError(err) && typeof err.details?.documentId === "string") id = err.details.documentId;
    else throw err;
  }
  // The previous version is replaced (Brain documents are immutable).
  if (item.brainDocumentId && item.brainDocumentId !== id) await deleteDocument(ctx, run.organizationId, run.companyId, item.brainDocumentId).catch(() => undefined);
  return id;
}

async function finishAi(run: RunRow, item: ItemRow, def: KitDef, output: string | null) {
  // Claim the conversion so concurrent advances never save the deliverable twice (a stale claim is taken over).
  const { count } = await db().builderKitItem.updateMany({
    where: { id: item.id, status: "GENERATING", agentTaskId: item.agentTaskId, OR: [{ errorCode: null }, { errorCode: "applying", updatedAt: { lt: new Date(Date.now() - 5 * 60_000) } }] },
    data: { errorCode: "applying" },
  });
  if (!count) return;
  if (!output?.trim()) return fail(item, "builder_no_output", "The AI task completed without a deliverable");
  const json = def.schema ? extractJson(output) : null;
  const content = markdownPart(output, json);
  const prior = (item.data as Record<string, unknown> | null) ?? {};
  let data: Record<string, unknown> | null = def.research ? { sources: prior.sources ?? [], research: prior.research ?? null } : null;
  if (def.schema) {
    let raw: unknown = null;
    try {
      raw = json ? JSON.parse(json) : null;
    } catch {
      raw = null;
    }
    const r = def.schema.safeParse(raw);
    if (!r.success) {
      await db().builderKitItem.update({ where: { id: item.id }, data: { content } });
      return fail(item, raw ? "builder_invalid_output" : "builder_no_json", "The AI's structured part did not pass validation; regenerate this deliverable", r.success ? [] : r.error.issues.slice(0, 12).map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`));
    }
    data = { ...(data ?? {}), ...(r.data as Record<string, unknown>) };
  }
  let docId: string | null = item.brainDocumentId;
  try {
    docId = await saveToBrain(run, founderCtx(run), item, content + sourceList(data), def);
  } catch (err) {
    logger.warn({ runId: run.id, item: item.key, err: errorText(err) }, "founder kit document not saved to Brain");
  }
  await db().builderKitItem.updateMany({
    where: { id: item.id, status: "GENERATING" },
    data: { status: "READY", content, data: (data ?? Prisma.DbNull) as Prisma.InputJsonValue, brainDocumentId: docId, generatedAt: new Date(), edited: false, approvedAt: null, approvedById: null, errorCode: null, errorMessage: null, errorIssues: [] },
  });
}

/** Move the kit forward as far as it can go now. `inline` (requests) never generates the logo (slow); the worker does. */
export async function advanceKit(runId: string, opts: { inline?: boolean } = {}): Promise<number> {
  const run = await db().builderRun.findUnique({ where: { id: runId }, include: { company: { select: { name: true, baseCurrency: true } } } });
  if (!run || run.status === "CANCELLED") return 0;
  let items = await db().builderKitItem.findMany({ where: { runId } });
  if (!items.length) return 0;
  let n = 0;
  // 1. Finished tasks → deliverables.
  const generating = items.filter((i) => i.status === "GENERATING" && i.agentTaskId);
  if (generating.length) {
    const tasks = await db().agentTask.findMany({ where: { id: { in: generating.map((i) => i.agentTaskId!) }, companyId: run.companyId }, select: { id: true, status: true, output: true, errorCode: true, errorMessage: true } });
    for (const item of generating) {
      const task = tasks.find((t) => t.id === item.agentTaskId);
      const def = kitDef(item.key);
      if (!def) continue;
      if (!task) await fail(item, "builder_task_missing", "The AI task no longer exists");
      else if (task.status === "FAILED" || task.status === "CANCELLED") await fail(item, task.errorCode ?? "builder_task_failed", task.errorMessage ?? "The AI task did not finish");
      else if (task.status === "COMPLETED") await finishAi(run, item, def, task.output);
      else continue;
      n++;
    }
    if (n) items = await db().builderKitItem.findMany({ where: { runId } });
  }
  // 2. Start what is ready to start.
  const ready = new Set(items.filter((i) => i.status === "READY").map((i) => i.key));
  const present = new Set(items.map((i) => i.key));
  let busy = items.filter((i) => i.status === "GENERATING" && i.key !== "logo").length;
  const order = [...items].sort((a, b) => KIT_KEYS.indexOf(a.key as KitKey) - KIT_KEYS.indexOf(b.key as KitKey));
  for (const item of order) {
    if (item.status !== "PENDING") continue;
    const def = kitDef(item.key);
    if (!def || !def.deps.every((d) => ready.has(d) || !present.has(d))) continue;
    if (def.kind === "image") {
      if (opts.inline) continue;
      try {
        await generateLogo(run, item, items);
      } catch (err) {
        logger.warn({ runId, err: errorText(err) }, "founder kit logo failed");
        await fail(item, errorReason(err), errorText(err));
      }
      n++;
      continue;
    }
    if (busy >= MAX_PARALLEL) continue;
    if (!aiConfigured()) break;
    const r = await startAi(run, item, def, items);
    if (r === "started") {
      busy++;
      n++;
    }
    if (r === "blocked") break;
  }
  if (n) await notifyIfComplete(run);
  return n;
}

async function notifyIfComplete(run: RunRow) {
  const open = await db().builderKitItem.count({ where: { runId: run.id, status: { in: ["PENDING", "GENERATING"] } } });
  if (open) return;
  const total = await db().builderKitItem.count({ where: { runId: run.id } });
  const ready = await db().builderKitItem.count({ where: { runId: run.id, status: "READY" } });
  if (ready !== total) return;
  await transaction(async (tx) => {
    const already = await tx.notification.findFirst({ where: { organizationId: run.organizationId, userId: run.createdById, type: "builder.kit_ready", payload: { path: ["href"], equals: `/builder/${run.id}/kit` } }, select: { id: true } });
    if (!already) await notifyUsers(tx, run.organizationId, [run.createdById], "builder.kit_ready", { companyId: run.companyId, title: run.company.name, href: `/builder/${run.id}/kit` });
  });
}

/** Periodic sweep: every kit with work in progress. */
export async function advanceActiveKits(): Promise<number> {
  const rows = await db().builderKitItem.findMany({ where: { status: { in: ["PENDING", "GENERATING"] } }, select: { runId: true }, distinct: ["runId"], orderBy: { updatedAt: "asc" }, take: 50 });
  let n = 0;
  for (const r of rows) {
    try {
      n += await advanceKit(r.runId);
    } catch (err) {
      logger.error({ runId: r.runId, err: errorText(err) }, "founder kit advance failed");
    }
  }
  return n;
}

// ───────────── Founder actions ─────────────

/** Create the kit for a run (idempotent: only missing items are added) and start what can start. */
export async function startKit(ctx: RequestContext, organizationId: string, companyId: string, runId: string) {
  await authorize(ctx, organizationId, companyId, "companies.manage");
  // The Founder Kit (full AI deliverable set incl. website structure) is the advanced Company Builder.
  await assertFeature(ctx, organizationId, "feature.company_builder_advanced");
  const run = await loadRun(organizationId, companyId, runId);
  if (run.status === "CANCELLED") throw conflict("This run was cancelled", { reason: "builder_not_active" });
  const { count } = await db().builderKitItem.createMany({ data: KIT.map((d) => ({ organizationId, companyId, runId, key: d.key })), skipDuplicates: true });
  if (count) await writeAudit(db(), ctx, { category: "TENANT", organizationId, action: "builder.kit.started", resourceType: "builder_run", resourceId: runId, newValue: { items: count } });
  await advanceKit(runId, { inline: true });
  return { created: count };
}

export async function nudgeKit(ctx: RequestContext, organizationId: string, companyId: string, runId: string) {
  await authorize(ctx, organizationId, companyId, "companies.read");
  await loadRun(organizationId, companyId, runId);
  return { transitions: await advanceKit(runId, { inline: true }) };
}

async function itemOf(organizationId: string, companyId: string, runId: string, key: string) {
  const run = await loadRun(organizationId, companyId, runId);
  const item = await db().builderKitItem.findFirst({ where: { runId, organizationId, companyId, key } });
  if (!item || !kitDef(key)) throw notFound("Founder Kit deliverable");
  return { run, item, def: kitDef(key)! };
}

export const regenerateInput = z.object({ feedback: z.string().trim().max(2000).optional() });

/** Generate a deliverable again (optionally with the founder's feedback); the current version stays visible until then. */
export async function regenerateItem(ctx: RequestContext, organizationId: string, companyId: string, runId: string, key: string, raw: z.input<typeof regenerateInput> = {}) {
  const input = regenerateInput.parse(raw);
  await authorize(ctx, organizationId, companyId, "companies.manage");
  const { item } = await itemOf(organizationId, companyId, runId, key);
  const stuck = item.status === "GENERATING" && !item.agentTaskId && item.updatedAt.getTime() < Date.now() - 10 * 60_000;
  if (item.status === "GENERATING" && !stuck) throw conflict("This deliverable is being generated right now", { reason: "builder_kit_generating" });
  if (!aiConfigured() && key !== "logo") throw new AppError("not_configured", "AI provider not configured", { reason: "ai_not_configured" });
  await db().builderKitItem.update({ where: { id: item.id }, data: { status: "PENDING", agentTaskId: null, feedback: input.feedback ?? null, errorCode: null, errorMessage: null, errorIssues: [] } });
  await writeAudit(db(), ctx, { category: "TENANT", organizationId, action: "builder.kit.regenerated", resourceType: "builder_kit_item", resourceId: item.id, newValue: { key, feedback: input.feedback ?? null } });
  // The logo is generated right away on request (the founder is waiting for it); AI deliverables are queued.
  if (key === "logo") {
    const run = await db().builderRun.findUniqueOrThrow({ where: { id: runId }, include: { company: { select: { name: true, baseCurrency: true } } } });
    const items = await db().builderKitItem.findMany({ where: { runId } });
    await generateLogo(run, { ...item, status: "PENDING" }, items).catch(async (err) => fail(item, errorReason(err), errorText(err)));
  } else {
    await advanceKit(runId, { inline: true });
  }
  return db().builderKitItem.findUniqueOrThrow({ where: { id: item.id }, select: { status: true, errorCode: true, errorMessage: true } });
}

export const editInput = z.object({ content: z.string().trim().min(1).max(200_000).optional(), data: z.unknown().optional() });

/** Save the founder's edited version (Markdown and/or the structured part, validated) and refresh its Brain document. */
export async function editItem(ctx: RequestContext, organizationId: string, companyId: string, runId: string, key: string, raw: z.input<typeof editInput>) {
  const input = editInput.parse(raw);
  await authorize(ctx, organizationId, companyId, "companies.manage");
  const { run, item, def } = await itemOf(organizationId, companyId, runId, key);
  if (item.status !== "READY") throw conflict("Only a ready deliverable can be edited", { reason: "builder_kit_not_ready" });
  let data = item.data as Record<string, unknown> | null;
  if (input.data !== undefined) {
    if (!def.schema) throw invalid("This deliverable has no structured part", { reason: "builder_kit_no_data" });
    const r = def.schema.safeParse(input.data);
    if (!r.success) throw invalid("Some fields are not valid", { reason: "builder_kit_invalid_data", issues: r.error.issues.slice(0, 20).map((i) => ({ path: i.path.join("."), message: i.message })) });
    data = { ...(data ?? {}), ...(r.data as Record<string, unknown>) };
  }
  const content = input.content ?? item.content ?? "";
  const runRow = { ...run, company: run.company };
  let docId = item.brainDocumentId;
  if (key !== "logo") docId = await saveToBrain(runRow, ctx, item, content + sourceList(data), def).catch(() => item.brainDocumentId);
  await db().builderKitItem.update({ where: { id: item.id }, data: { content, data: (data ?? Prisma.DbNull) as Prisma.InputJsonValue, brainDocumentId: docId, edited: true, approvedAt: null, approvedById: null } });
  await writeAudit(db(), ctx, { category: "TENANT", organizationId, action: "builder.kit.edited", resourceType: "builder_kit_item", resourceId: item.id, newValue: { key, content: input.content !== undefined, data: input.data !== undefined } });
  return { ok: true };
}

export async function approveItem(ctx: RequestContext, organizationId: string, companyId: string, runId: string, key: string, approved: boolean) {
  await authorize(ctx, organizationId, companyId, "companies.manage");
  const { item } = await itemOf(organizationId, companyId, runId, key);
  if (item.status !== "READY") throw conflict("Only a ready deliverable can be approved", { reason: "builder_kit_not_ready" });
  await db().builderKitItem.update({ where: { id: item.id }, data: approved ? { approvedAt: new Date(), approvedById: ctx.actor.id ?? null } : { approvedAt: null, approvedById: null } });
  await writeAudit(db(), ctx, { category: "TENANT", organizationId, action: approved ? "builder.kit.approved" : "builder.kit.unapproved", resourceType: "builder_kit_item", resourceId: item.id, newValue: { key } });
  return { ok: true };
}

// ───────────── Read ─────────────

export type KitActionRecord = { action: string; kind: string; id: string; label: string; href: string | null; at: string };

/** Everything the kit page shows, from the database only (plus provider/AI availability for honest states). */
export async function getKitView(ctx: RequestContext, organizationId: string, companyId: string, runId: string) {
  await authorize(ctx, organizationId, companyId, "companies.read");
  const run = await loadRun(organizationId, companyId, runId);
  const items = await db().builderKitItem.findMany({ where: { runId, organizationId, companyId } });
  const taskIds = items.map((i) => i.agentTaskId).filter((x): x is string => !!x);
  const [tasks, images, research, refusal] = await Promise.all([
    db().agentTask.findMany({ where: { organizationId, companyId, id: { in: taskIds } }, select: { id: true, status: true, profile: true, startedAt: true } }),
    imageProviderStatus(organizationId, companyId),
    db().integrationConnection.count({ where: { organizationId, companyId, provider: { in: ["tavily", "exa", "serpapi"] }, status: "CONNECTED" } }),
    aiRefusal(organizationId, { model: await agentModel(env().AGENT_MODEL) }).catch(() => null),
  ]);
  const byKey = new Map(items.map((i) => [i.key, i]));
  return {
    run: { id: run.id, status: run.status, companyId: run.companyId, companyName: run.company.name, baseCurrency: run.company.baseCurrency, journey: run.journey, mode: run.mode, brief: parseBrief(run.brief), createdById: run.createdById },
    started: items.length > 0,
    items: KIT.filter((d) => byKey.has(d.key)).map((d) => {
      const i = byKey.get(d.key)!;
      return {
        key: d.key,
        kind: d.kind,
        deps: d.deps,
        actions: d.actions,
        hasSchema: !!d.schema,
        status: i.status,
        content: i.content,
        data: i.data as Record<string, unknown> | null,
        edited: i.edited,
        approvedAt: i.approvedAt,
        feedback: i.feedback,
        brainDocumentId: i.brainDocumentId,
        records: (Array.isArray(i.actions) ? i.actions : []) as KitActionRecord[],
        errorCode: i.errorCode,
        errorMessage: i.errorMessage,
        errorIssues: i.errorIssues,
        generatedAt: i.generatedAt,
        task: i.agentTaskId ? (tasks.find((t) => t.id === i.agentTaskId) ?? null) : null,
      };
    }),
    availability: { ai: aiConfigured(), aiRefusal: refusal, images: images.any, research: research > 0 },
  };
}
export type KitView = Awaited<ReturnType<typeof getKitView>>;
