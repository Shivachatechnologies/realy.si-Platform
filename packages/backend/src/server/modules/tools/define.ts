import type { z } from "zod";
import type { RequestContext } from "@/server/core/context";
import type { ToolAutonomy, ToolRisk } from "@/generated/prisma/enums";

/**
 * Tool contract (docs/tool-system.md §1). Business modules define their tools in src/server/modules/<module>/ai-tools.ts
 * with `def` and register them in ./modules.ts; the gateway enforces allow-list, input schema, the principal's
 * permissions and the autonomy policy before `execute` runs. Every tool is scoped to the calling task's company.
 */

export interface Citable {
  passageId: string;
  documentId: string;
  title: string;
  passage: number;
}

export interface ToolExecutionContext {
  /** The principal the tool acts for: the task's requester, or — for an approved action — the approver. */
  ctx: RequestContext;
  organizationId: string;
  companyId: string;
  /** Registers a retrieved passage as citable and returns its reference (e.g. "S1"). */
  cite?: (source: Citable) => string;
}

export interface ToolOutput {
  /** Text returned to the model. */
  content: string;
  /** Records read or changed, as "type:id" (audit trail). */
  records?: string[];
  /** Number of items returned (reads) for the task trace. */
  count?: number;
}

export interface ToolDefinition<I = unknown> {
  /** snake_case, unique across all modules. */
  name: string;
  version: number;
  description: string;
  input: z.ZodType<I>;
  /** JSON Schema sent to the model (strict: only type/properties/required/enum/description/additionalProperties). */
  modelSchema: Record<string, unknown>;
  permissions: string[];
  risk: ToolRisk;
  autonomy: ToolAutonomy;
  timeoutMs: number;
  /** One line describing the effect, shown on approval requests. */
  summarize(input: I): string;
  execute(input: I, x: ToolExecutionContext): Promise<ToolOutput>;
}

export const def = <I>(t: ToolDefinition<I>) => t as unknown as ToolDefinition;
