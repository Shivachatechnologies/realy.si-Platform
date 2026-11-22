import { z } from "zod";
import { db } from "@/server/core/db";
import { AppError } from "@/server/core/errors";
import type { RequestContext } from "@/server/core/context";
import { def, type ToolDefinition } from "@/server/modules/tools/define";
import { createTask, getTask } from "@/server/modules/agents/service";
import { delegationMode } from "./autonomy";
import { delegationLimitReason, MAX_DELEGATIONS_PER_TASK, proposeDelegation, receiverUnavailableReason } from "./delegation";
import { canDelegate, currentEmployee, escalate, fileStatusReport } from "./hierarchy";
import { listEmployees } from "./service";

/** The task a tool call runs inside: task executions use the request id `task_<taskId>` (agents/service.ts). */
function currentTaskId(ctx: RequestContext): string | null {
  const m = /^task_([0-9a-f-]{36})$/.exec(ctx.requestId);
  return m ? m[1]! : null;
}

/** AI tools of the workforce module, registered in src/server/modules/tools/modules.ts. */
export const WORKFORCE_TOOLS: Record<string, ToolDefinition> = {
  read_ai_employees: def({
    name: "read_ai_employees",
    version: 1,
    description: "Lists the company's AI employees (id, name, role, department, status, skills). Use it to choose a colleague before delegating.",
    input: z.object({}).strict(),
    modelSchema: { type: "object", properties: {}, required: [], additionalProperties: false },
    permissions: ["agents.read"],
    risk: "LOW",
    autonomy: "AUTONOMOUS",
    timeoutMs: 15_000,
    summarize: () => "List AI employees",
    async execute(_input, { ctx, organizationId, companyId }) {
      const rows = await listEmployees(ctx, organizationId, companyId);
      if (!rows.length) return { content: "The company has no AI employees yet.", count: 0 };
      const content = rows
        .map(
          (e) =>
            `- ${e.id}: ${e.name}${e.jobTitle ? ` (${e.jobTitle})` : ""} — role ${e.profileKey}, ${e.level.toLowerCase()}, department ${e.department}, ${e.status.toLowerCase()}${e.manager ? `, reports to ${e.manager.name} (${e.manager.id})` : ", reports to the founder"}${e.skills.length ? `, skills: ${e.skills.join(", ")}` : ""}`,
        )
        .join("\n");
      return { content, count: rows.length, records: rows.map((e) => `ai_employee:${e.id}`) };
    },
  }),

  delegate_to_ai_employee: def({
    name: "delegate_to_ai_employee",
    version: 1,
    description:
      `Delegate a sub-task to another active AI employee (use read_ai_employees for ids). Managers delegate to their own reports (direct or indirect); executives to anyone. If you work under supervision, this files a proposal that a person approves before the work starts; otherwise it creates a separate task that runs in the background. Read results later with read_task_result; finished sub-tasks are also rolled up to you automatically. Limits: two delegation levels, at most ${MAX_DELEGATIONS_PER_TASK} sub-tasks per task, and the colleague must have budget left. Give complete, self-contained instructions.`,
    input: z.object({ aiEmployeeId: z.string().uuid(), title: z.string().trim().min(1).max(200), instructions: z.string().trim().min(1).max(6000) }).strict(),
    modelSchema: {
      type: "object",
      properties: {
        aiEmployeeId: { type: "string", description: "AI employee id from read_ai_employees" },
        title: { type: "string" },
        instructions: { type: "string", description: "Self-contained instructions: context, deliverable, format" },
      },
      required: ["aiEmployeeId", "title", "instructions"],
      additionalProperties: false,
    },
    permissions: ["agents.run"],
    risk: "LOW",
    autonomy: "AUTONOMOUS",
    timeoutMs: 20_000,
    summarize: ({ title }) => `Delegate "${title}" to an AI employee`,
    async execute({ aiEmployeeId, title, instructions }, { ctx, organizationId, companyId }) {
      const parentTaskId = currentTaskId(ctx);
      if (!parentTaskId) {
        // Executed after a person approved it in Approvals (the platform requires approval for AI writes): the person
        // assigns the work themselves, with their own permissions and the normal budget checks.
        const t = await createTask(ctx, organizationId, companyId, { aiEmployeeId, title, instructions });
        return { content: `Assigned as task ${t.id} (status ${t.status}).`, records: [`agent_task:${t.id}`] };
      }
      const me = await currentEmployee(organizationId, companyId, parentTaskId);
      if (me && !(await canDelegate(organizationId, companyId, me, aiEmployeeId))) {
        return { content: "Not delegated: you can only delegate to AI employees who report to you (see read_ai_employees). Escalate to your manager with escalate_to_manager if someone else must do it.", count: 0 };
      }
      const limit = await delegationLimitReason(organizationId, companyId, parentTaskId);
      if (limit) return { content: `Not delegated: ${limit}`, count: 0 };
      const unavailable = await receiverUnavailableReason(organizationId, companyId, aiEmployeeId);
      if (unavailable) return { content: `Not delegated: ${unavailable}`, count: 0 };
      if (me) {
        const autonomy = (await db().aiEmployee.findFirst({ where: { id: me.id, companyId }, select: { autonomy: true } }))?.autonomy ?? "EXECUTE_WITH_APPROVAL";
        if (delegationMode(autonomy) === "propose") {
          const d = await proposeDelegation(ctx, organizationId, companyId, { parentTaskId, fromEmployeeId: me.id, fromName: me.name, toEmployeeId: aiEmployeeId, title, instructions });
          return {
            content: `Proposed (not started yet): a person must approve this delegation first (proposal ${d.id}). Continue with what you can do yourself and list the proposal as pending in your deliverable; if approved, the result is rolled up to you.`,
            records: [`ai_delegation:${d.id}`],
          };
        }
      }
      const child = await createTask(ctx, organizationId, companyId, { aiEmployeeId, title, instructions }, { parentTaskId });
      return { content: `Delegated as task ${child.id} (status ${child.status}). Read its result later with read_task_result; it may take a few minutes, and it is rolled up to you when done.`, records: [`agent_task:${child.id}`] };
    },
  }),

  read_task_result: def({
    name: "read_task_result",
    version: 1,
    description: "Returns the status and, when completed, the deliverable of an AI task this task delegated (or any task of the company by id).",
    input: z.object({ taskId: z.string().uuid() }).strict(),
    modelSchema: { type: "object", properties: { taskId: { type: "string", description: "Task id returned by delegate_to_ai_employee" } }, required: ["taskId"], additionalProperties: false },
    permissions: ["agents.read"],
    risk: "LOW",
    autonomy: "AUTONOMOUS",
    timeoutMs: 15_000,
    summarize: () => "Read an AI task's result",
    async execute({ taskId }, { ctx, organizationId, companyId }) {
      const t = await getTask(ctx, organizationId, companyId, taskId);
      const who = t.aiEmployeeId ? (await db().aiEmployee.findFirst({ where: { id: t.aiEmployeeId, companyId }, select: { name: true } }))?.name : null;
      const head = `Task ${t.id} "${t.title}"${who ? ` by ${who}` : ""}: ${t.status}`;
      if (t.status === "COMPLETED") return { content: `${head}\n\n${(t.output ?? "").slice(0, 20_000)}`, count: 1, records: [`agent_task:${t.id}`] };
      if (t.status === "FAILED") return { content: `${head} — ${t.errorMessage ?? t.errorCode ?? "failed"}`, count: 1 };
      return { content: `${head} — not finished yet. Continue with other work and check again later, or report it as in progress.`, count: 0 };
    },
  }),

  report_to_manager: def({
    name: "report_to_manager",
    version: 1,
    description:
      "File a short status report with your manager (another AI employee, or the founder at the top of the org chart). It appears on your manager's page. Use it at the end of significant work: what was done, results with numbers, open points.",
    input: z.object({ title: z.string().trim().min(1).max(200), body: z.string().trim().min(1).max(6000) }).strict(),
    modelSchema: {
      type: "object",
      properties: { title: { type: "string" }, body: { type: "string", description: "Markdown: done, results, open points" } },
      required: ["title", "body"],
      additionalProperties: false,
    },
    permissions: ["agents.read"],
    risk: "LOW",
    autonomy: "AUTONOMOUS",
    timeoutMs: 15_000,
    summarize: ({ title }) => `Report "${title}" to the manager`,
    async execute({ title, body }, { ctx, organizationId, companyId }) {
      const taskId = currentTaskId(ctx);
      if (!taskId) throw new AppError("conflict", "Reports can only be filed from inside a task");
      const r = await fileStatusReport(ctx, organizationId, companyId, taskId, { title, body });
      if (!r) return { content: "Only AI employees have a manager to report to; include the report in your deliverable instead.", count: 0 };
      return { content: `Report filed with ${r.to}.`, records: [`ai_employee_report:${r.id}`] };
    },
  }),

  escalate_to_manager: def({
    name: "escalate_to_manager",
    version: 1,
    description:
      "Escalate a blocker or a failure you cannot resolve to your manager: creates a task for your AI manager with your explanation, or notifies the founder when you are at the top of the org chart. State what you tried, what blocks you and what decision or help you need.",
    input: z.object({ title: z.string().trim().min(1).max(200), details: z.string().trim().min(1).max(6000) }).strict(),
    modelSchema: {
      type: "object",
      properties: { title: { type: "string", description: "The blocker in one line" }, details: { type: "string", description: "What you tried, what blocks you, what you need" } },
      required: ["title", "details"],
      additionalProperties: false,
    },
    permissions: ["agents.run"],
    risk: "LOW",
    autonomy: "AUTONOMOUS",
    timeoutMs: 20_000,
    summarize: ({ title }) => `Escalate "${title}" to the manager`,
    async execute({ title, details }, { ctx, organizationId, companyId }) {
      const taskId = currentTaskId(ctx);
      if (!taskId) throw new AppError("conflict", "Escalation is only possible from inside a task");
      const r = await escalate(ctx, organizationId, companyId, taskId, { title, details });
      if (!r) return { content: "Only AI employees can escalate; describe the blocker in your deliverable instead.", count: 0 };
      if (r.taskId) return { content: `Escalated to ${r.to} as task ${r.taskId}. Continue with what you can do and mention the escalation in your deliverable.`, records: [`agent_task:${r.taskId}`, `ai_employee_report:${r.id}`] };
      return { content: `Escalated to ${r.to}${r.notified ? " (notified)" : ""}. Mention the escalation in your deliverable.`, records: [`ai_employee_report:${r.id}`] };
    },
  }),

  // ── G1 (B25): security posture for the AI CISO ──
  read_security_posture: def({
    name: "read_security_posture",
    version: 1,
    description:
      "Reads the company's security posture from real records: members and how many use two-factor authentication, active API keys (unused or never expiring), broken integration connections, security events in the audit log over the last 30 days, and whether all AI is paused. Use it before advising on security; never guess figures it does not return.",
    input: z.object({}).strict(),
    modelSchema: { type: "object", properties: {}, required: [], additionalProperties: false },
    permissions: ["audit.read"],
    risk: "LOW",
    autonomy: "AUTONOMOUS",
    timeoutMs: 20_000,
    summarize: () => "Read the security posture",
    async execute(_input, { organizationId, companyId }) {
      const since = new Date(Date.now() - 30 * 86_400_000);
      const stale = new Date(Date.now() - 90 * 86_400_000);
      const [members, keys, connections, events, paused] = await Promise.all([
        db().membership.findMany({ where: { organizationId, status: "ACTIVE" }, select: { userId: true } }),
        db().apiKey.findMany({ where: { organizationId, revokedAt: null }, select: { lastUsedAt: true, expiresAt: true, createdAt: true } }),
        db().integrationConnection.groupBy({ by: ["status"], where: { organizationId, companyId }, _count: { _all: true } }),
        db().auditLog.groupBy({ by: ["action"], where: { organizationId, category: "SECURITY", createdAt: { gte: since } }, _count: { _all: true }, orderBy: { _count: { action: "desc" } }, take: 15 }),
        (await import("./autonomy-policy")).isCompanyAiPaused(organizationId, companyId),
      ]);
      const ids = members.map((m) => m.userId);
      const withMfa = ids.length ? (await db().mfaFactor.groupBy({ by: ["userId"], where: { userId: { in: ids }, confirmedAt: { not: null } } })).length : 0;
      const active = keys.filter((k) => !k.expiresAt || k.expiresAt > new Date());
      const conn = Object.fromEntries(connections.map((c) => [c.status, c._count._all]));
      const lines = [
        `Members: ${ids.length}; with two-factor authentication: ${withMfa}${ids.length ? ` (${Math.round((withMfa / ids.length) * 100)}%)` : ""}.`,
        `Active API keys: ${active.length}; never expiring: ${active.filter((k) => !k.expiresAt).length}; unused for 90+ days: ${active.filter((k) => (k.lastUsedAt ?? k.createdAt) < stale).length}.`,
        `Integration connections — connected: ${conn.CONNECTED ?? 0}, in error: ${conn.ERROR ?? 0}, disconnected: ${conn.DISCONNECTED ?? 0}.`,
        events.length ? `Security events (last 30 days): ${events.map((e) => `${e.action} ×${e._count._all}`).join(", ")}.` : "Security events (last 30 days): none recorded.",
        `All AI paused (kill switch): ${paused ? "yes" : "no"}.`,
      ];
      return { content: lines.join("\n"), count: lines.length };
    },
  }),
};
