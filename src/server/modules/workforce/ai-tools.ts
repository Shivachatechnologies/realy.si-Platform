import { z } from "zod";
import { db } from "@/server/core/db";
import { AppError } from "@/server/core/errors";
import type { RequestContext } from "@/server/core/context";
import { def, type ToolDefinition } from "@/server/modules/tools/define";
import { createTask, getTask } from "@/server/modules/agents/service";
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
        .map((e) => `- ${e.id}: ${e.name} — role ${e.profileKey}, department ${e.department}, ${e.status.toLowerCase()}${e.skills.length ? `, skills: ${e.skills.join(", ")}` : ""}`)
        .join("\n");
      return { content, count: rows.length, records: rows.map((e) => `ai_employee:${e.id}`) };
    },
  }),

  delegate_to_ai_employee: def({
    name: "delegate_to_ai_employee",
    version: 1,
    description: "Delegate a sub-task to another active AI employee (use read_ai_employees for ids). Creates a separate task that runs in the background; read its result later with read_task_result. Delegation is limited to two levels. Give complete, self-contained instructions.",
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
      if (!parentTaskId) throw new AppError("conflict", "Delegation is only possible from inside a task");
      const child = await createTask(ctx, organizationId, companyId, { aiEmployeeId, title, instructions }, { parentTaskId });
      return { content: `Delegated as task ${child.id} (status ${child.status}). Read its result later with read_task_result; it may take a few minutes.`, records: [`agent_task:${child.id}`] };
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
};
