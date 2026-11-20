import { Badge } from "@/components/ui/badge";
import type { Translate } from "@/i18n/translate";
import { formatDateTime, formatRelativeTime } from "@/i18n/format";

export const STATUS_TONE = { NEW: "accent", OPEN: "accent", PENDING: "warning", ON_HOLD: "neutral", SOLVED: "success", CLOSED: "neutral" } as const;
export const PRIORITY_TONE = { LOW: "neutral", NORMAL: "neutral", HIGH: "warning", URGENT: "danger" } as const;

export function StatusBadge({ t, status }: { t: Translate; status: keyof typeof STATUS_TONE }) {
  return <Badge tone={STATUS_TONE[status]}>{t(`support.statuses.${status}`)}</Badge>;
}

export function PriorityBadge({ t, priority }: { t: Translate; priority: keyof typeof PRIORITY_TONE }) {
  return <Badge tone={PRIORITY_TONE[priority]}>{t(`support.priorities.${priority}`)}</Badge>;
}

/** SLA state of a ticket: breached, at risk (< 1h) or the due time. */
export function SlaBadge({ t, locale, tz, ticket }: { t: Translate; locale: string; tz: string; ticket: { status: string; firstRespondedAt: Date | null; firstResponseDueAt: Date | null; resolutionDueAt: Date | null; firstResponseBreachedAt: Date | null; resolutionBreachedAt: Date | null } }) {
  if (ticket.firstResponseBreachedAt || ticket.resolutionBreachedAt) return <Badge tone="danger">{t("support.sla.breached")}</Badge>;
  if (ticket.status === "SOLVED" || ticket.status === "CLOSED") return null;
  const due = !ticket.firstRespondedAt && ticket.firstResponseDueAt ? ticket.firstResponseDueAt : ticket.resolutionDueAt;
  if (!due) return null;
  const soon = due.getTime() - new Date().getTime() < 3_600_000;
  return (
    <Badge tone={soon ? "warning" : "neutral"} title={formatDateTime(due, locale, tz)}>
      {t(!ticket.firstRespondedAt && ticket.firstResponseDueAt ? "support.sla.respondBy" : "support.sla.resolveBy", { when: formatRelativeTime(due, locale) })}
    </Badge>
  );
}
