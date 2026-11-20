import { z } from "zod";
import { db } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { AppError } from "@/server/core/errors";
import { validateDefinition, flattenSteps, type Definition } from "./definition";
import { authorizeWorkflows, createWorkflow, publishWorkflow, requestAiDraft, setWorkflowStatus } from "./service";

/**
 * The plain-language builder (/workflows/new): the client turns "When this happens… / Only if… / Then…" choices into a
 * normal workflow Definition; here it is validated (validateDefinition), created, and — for "Turn on" — published and
 * activated through the existing workflow services. The advanced editor opens the same workflow.
 */
export const simpleWorkflowInput = z.object({
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(2000).optional(),
  definition: z.unknown(),
  activate: z.boolean().default(true),
});
export const describeInput = z.object({ description: z.string().trim().min(10).max(4000) });

export async function createSimpleWorkflow(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof simpleWorkflowInput>) {
  const input = simpleWorkflowInput.parse(raw);
  await authorizeWorkflows(ctx, organizationId, companyId, "workflows.manage");
  const v = validateDefinition(input.definition);
  if (!v.ok) throw new AppError("validation_error", "The workflow definition is invalid", { reason: "automation_workflow_invalid", issues: v.issues });
  const wf = await createWorkflow(ctx, organizationId, companyId, { name: input.name, description: input.description }, { draft: v.definition });
  if (!input.activate) return { id: wf.id, active: false };
  await publishWorkflow(ctx, organizationId, companyId, wf.id);
  await setWorkflowStatus(ctx, organizationId, companyId, wf.id, { status: "ACTIVE" });
  return { id: wf.id, active: true };
}

/** "Describe it and AI builds it": a new workflow whose draft the automation architect writes (never auto-published). */
export async function describeWorkflow(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof describeInput>) {
  const { description } = describeInput.parse(raw);
  const name = description.split(/[.\n]/)[0]!.trim().slice(0, 80) || "New automation";
  const wf = await createWorkflow(ctx, organizationId, companyId, { name, description: description.slice(0, 2000) });
  const task = await requestAiDraft(ctx, organizationId, companyId, wf.id, { description });
  return { id: wf.id, taskId: task.id };
}

/** Automation map data: active workflows with their trigger, step chain and live run counts (last 24h / 30 days). */
export async function automationMap(ctx: RequestContext, organizationId: string, companyId: string) {
  await authorizeWorkflows(ctx, organizationId, companyId, "workflows.read");
  const wfs = await db().workflow.findMany({
    where: { organizationId, companyId, status: "ACTIVE", currentVersionId: { not: null } },
    orderBy: { updatedAt: "desc" },
    take: 12,
    select: { id: true, name: true, currentVersionId: true },
  });
  const versions = await db().workflowVersion.findMany({ where: { id: { in: wfs.map((w) => w.currentVersionId!) } }, select: { id: true, definition: true } });
  const ids = wfs.map((w) => w.id);
  const [day, month, running] = ids.length
    ? await Promise.all([
        db().workflowRun.groupBy({ by: ["workflowId"], where: { workflowId: { in: ids }, createdAt: { gte: new Date(Date.now() - 86_400_000) } }, _count: { _all: true } }),
        db().workflowRun.groupBy({ by: ["workflowId", "status"], where: { workflowId: { in: ids }, createdAt: { gte: new Date(Date.now() - 30 * 86_400_000) } }, _count: { _all: true } }),
        db().workflowRun.groupBy({ by: ["workflowId"], where: { workflowId: { in: ids }, status: { in: ["QUEUED", "RUNNING", "WAITING"] } }, _count: { _all: true } }),
      ])
    : [[], [], []];
  return wfs.map((w) => {
    const def = versions.find((v) => v.id === w.currentVersionId)?.definition as unknown as Definition | undefined;
    const steps = def ? flattenSteps(def.steps ?? []) : [];
    const m = month.filter((x) => x.workflowId === w.id);
    return {
      id: w.id,
      name: w.name,
      trigger: def?.trigger ?? null,
      steps: steps.slice(0, 5).map((s) => (s.type === "action" ? { type: "action" as const, kind: s.action.kind } : { type: s.type, kind: null })),
      moreSteps: Math.max(0, steps.length - 5),
      runs24h: day.find((x) => x.workflowId === w.id)?._count._all ?? 0,
      runs30d: m.reduce((n, x) => n + x._count._all, 0),
      failed30d: m.find((x) => x.status === "FAILED")?._count._all ?? 0,
      running: running.find((x) => x.workflowId === w.id)?._count._all ?? 0,
    };
  });
}
