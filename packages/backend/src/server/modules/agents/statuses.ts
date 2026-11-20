import type { AgentTaskStatus } from "@/generated/prisma/enums";

export const AGENT_TASK_STATUSES = ["QUEUED", "RUNNING", "COMPLETED", "FAILED", "CANCELLED"] as const satisfies readonly AgentTaskStatus[];
