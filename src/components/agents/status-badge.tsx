import { Badge } from "@/components/ui/badge";
import type { AgentTaskStatus } from "@/generated/prisma/enums";

const TONE = { QUEUED: "neutral", RUNNING: "warning", COMPLETED: "success", FAILED: "danger", CANCELLED: "neutral" } as const;

export function TaskStatusBadge({ status, label }: { status: AgentTaskStatus; label: string }) {
  return <Badge tone={TONE[status]}>{label}</Badge>;
}
