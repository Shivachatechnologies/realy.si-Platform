import { Badge } from "@/components/ui/badge";

/** Marketing status pill. Client-safe (no server imports) so client components can use it. */
const TONES: Record<string, "neutral" | "accent" | "success" | "warning" | "danger"> = {
  DRAFT: "neutral",
  PLANNED: "accent",
  ACTIVE: "success",
  PAUSED: "warning",
  COMPLETED: "neutral",
  IN_REVIEW: "warning",
  APPROVED: "accent",
  SCHEDULED: "accent",
  PUBLISHED: "success",
  PUBLISHING: "accent",
  PARTIAL: "warning",
  FAILED: "danger",
  CANCELLED: "neutral",
  PENDING: "neutral",
  SENT: "success",
  SENDING: "accent",
  NOT_CONFIGURED: "warning",
  STOPPED: "neutral",
  UNSUBSCRIBED: "warning",
  QUEUED: "neutral",
  RUNNING: "accent",
};

export function StatusBadge({ status, label }: { status: string; label: string }) {
  return <Badge tone={TONES[status] ?? "neutral"}>{label}</Badge>;
}
