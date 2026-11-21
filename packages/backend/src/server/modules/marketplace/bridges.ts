import type { Tx } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import type { Prisma } from "@/generated/prisma/client";
import type { Manifest } from "./manifest";
import { can } from "@/server/modules/rbac/service";
import { companyChain } from "@/server/modules/rbac/scope";
import { profileByKey } from "@/server/modules/agents/profiles";
import { departmentOf } from "@/server/modules/workforce/service";
import { EMPTY_DEFINITION, TRIGGER_EVENTS } from "@/server/modules/automation/definition";
import { templateByKey } from "@/server/modules/automation/templates";
import { assertLimit } from "@/server/modules/entitlements/service";

/**
 * Marketplace installs into the Automation, AI Workforce, CRM and Integrations modules, inside the install
 * transaction. Each returns what it actually created; skipped = already present or not permitted.
 */
export interface BridgeScope {
  organizationId: string;
  companyId: string;
  installationId: string;
}
export interface BridgeResult {
  created: number;
  skipped?: number;
  pending: boolean;
}

type Bridge<K extends keyof Manifest> = (tx: Tx, ctx: RequestContext, scope: BridgeScope, items: Manifest[K]) => Promise<BridgeResult>;

/** Installs a section only when the installer may manage that area at the company; otherwise nothing is created. */
async function allowed(tx: Tx, ctx: RequestContext, scope: BridgeScope, permission: string) {
  return can(ctx, permission, await companyChain(tx, scope.organizationId, scope.companyId), tx);
}
const skippedAll = (n: number): BridgeResult => ({ created: 0, skipped: n, pending: false });

/** Automation: one draft workflow per item (built-in template definition when the key matches one). Drafts are reviewed and published by a person. */
export const installWorkflows: Bridge<"workflows"> = async (tx, ctx, scope, items) => {
  if (!items.length || !ctx.actor.id || !(await allowed(tx, ctx, scope, "workflows.manage"))) return skippedAll(items.length);
  const existing = new Set((await tx.workflow.findMany({ where: { companyId: scope.companyId }, select: { name: true } })).map((w) => w.name));
  let created = 0;
  for (const w of items) {
    if (existing.has(w.name)) continue;
    const template = templateByKey(w.key);
    const event = (TRIGGER_EVENTS as readonly string[]).includes(w.trigger) ? (w.trigger as (typeof TRIGGER_EVENTS)[number]) : null;
    const definition = template?.definition ?? (event ? { ...EMPTY_DEFINITION, trigger: { type: "event" as const, event, filters: [] } } : EMPTY_DEFINITION);
    await tx.workflow.create({
      data: {
        organizationId: scope.organizationId,
        companyId: scope.companyId,
        name: w.name,
        description: w.description || null,
        ownerId: ctx.actor.id,
        createdById: ctx.actor.id,
        draft: definition as unknown as Prisma.InputJsonValue,
        templateKey: template?.key ?? null,
      },
    });
    created++;
  }
  return { created, skipped: items.length - created, pending: false };
};

/** AI Workforce: hires an AI employee per item for its role profile (paused roles stay editable on /workforce). */
export const installAiEmployees: Bridge<"aiEmployees"> = async (tx, ctx, scope, items) => {
  if (!items.length || !(await allowed(tx, ctx, scope, "agents.manage"))) return skippedAll(items.length);
  const existing = new Set(
    (await tx.aiEmployee.findMany({ where: { companyId: scope.companyId, archivedAt: null }, select: { name: true, profileKey: true } })).map((e) => `${e.profileKey}:${e.name}`),
  );
  let created = 0;
  for (const e of items) {
    const profile = profileByKey(e.profile);
    if (!profile || existing.has(`${profile.key}:${e.name}`)) continue;
    // Plan limit (reads committed rows, so count the ones created in this transaction too).
    await assertLimit(ctx, scope.organizationId, "agents.max", created + 1);
    await tx.aiEmployee.create({
      data: {
        organizationId: scope.organizationId,
        companyId: scope.companyId,
        name: e.name,
        initials: e.name.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("") || "AI",
        profileKey: profile.key,
        department: departmentOf(profile.key),
        instructions: e.description || null,
        createdById: ctx.actor.id ?? scope.organizationId,
      },
    });
    created++;
  }
  return { created, skipped: items.length - created, pending: false };
};

/** CRM: a pipeline per item with its stages in order, plus Won/Lost closing stages when the template has none. */
export const installPipelines: Bridge<"pipelines"> = async (tx, ctx, scope, items) => {
  if (!items.length || !(await allowed(tx, ctx, scope, "sales.manage"))) return skippedAll(items.length);
  const existing = await tx.crmPipeline.findMany({ where: { companyId: scope.companyId, archivedAt: null }, select: { name: true } });
  const names = new Set(existing.map((p) => p.name));
  let position = existing.length;
  let created = 0;
  for (const p of items) {
    if (names.has(p.name) || position >= 20) continue;
    const pipeline = await tx.crmPipeline.create({
      data: { organizationId: scope.organizationId, companyId: scope.companyId, name: p.name, isDefault: position === 0, position: position++ },
    });
    const open = p.stages.filter((n) => !/^(won|lost|closed won|closed lost)$/i.test(n.trim()));
    const stages = [
      ...open.map((name, i) => ({ name, type: "OPEN" as const, probability: Math.round(((i + 1) / (open.length + 1)) * 90) })),
      { name: p.stages.find((n) => /won/i.test(n)) ?? "Won", type: "WON" as const, probability: 100 },
      { name: p.stages.find((n) => /lost/i.test(n)) ?? "Lost", type: "LOST" as const, probability: 0 },
    ];
    await tx.crmPipelineStage.createMany({
      data: stages.map((st, i) => ({ organizationId: scope.organizationId, companyId: scope.companyId, pipelineId: pipeline.id, name: st.name, type: st.type, probability: st.probability, position: i })),
    });
    created++;
  }
  return { created, skipped: items.length - created, pending: false };
};

/** Skills are capability tags on AI employees: added to the company's active AI employees (none → nothing to add). */
export const installSkills: Bridge<"skills"> = async (tx, ctx, scope, items) => {
  if (!items.length || !(await allowed(tx, ctx, scope, "agents.manage"))) return skippedAll(items.length);
  const employees = await tx.aiEmployee.findMany({ where: { companyId: scope.companyId, archivedAt: null }, select: { id: true, skills: true } });
  if (!employees.length) return skippedAll(items.length);
  for (const e of employees) {
    const skills = [...new Set([...e.skills, ...items.map((s) => s.name.slice(0, 40))])].slice(0, 20);
    await tx.aiEmployee.update({ where: { id: e.id }, data: { skills } });
  }
  return { created: items.length, pending: false };
};

/** Integrations need the company's own credentials: every provider is already listed on /integrations ready to connect, so nothing is created and nothing is marked connected. */
export const installIntegrations: Bridge<"integrations"> = async (_tx, _ctx, _scope, items) => skippedAll(items.length);
