/** An AI employee role: a role prompt plus the tools it may use and its limits (see ./profiles.ts). */
export interface AgentProfile {
  key: string;
  /** Department, for grouping in the AI Workforce (executive, sales, marketing, finance, hr, engineering, product, support, operations, research). */
  department?: string;
  /** Role-specific guidance appended to the shared system prompt. */
  instructions: string;
  /** Tool names from the registry (core tools in tools/registry.ts, module tools in <module>/ai-tools.ts). */
  tools: readonly string[];
  /** Upper bound on model turns (each turn may call tools) for one execution. */
  maxTurns: number;
}
