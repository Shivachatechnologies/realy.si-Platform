import Link from "next/link";
import type { Approval } from "@/generated/prisma/client";
import { ApprovalActions } from "@/components/approvals/approval-actions";
import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/i18n/format";
import type { getT } from "@/i18n/server";

type T = Awaited<ReturnType<typeof getT>>;
const STATUS_TONE = { PENDING: "warning", APPROVED: "warning", EXECUTED: "success", REJECTED: "neutral", EXPIRED: "neutral", FAILED: "danger" } as const;
const RISK_TONE = { LOW: "neutral", MEDIUM: "accent", HIGH: "warning", CRITICAL: "danger" } as const;

export function ApprovalList({
  approvals,
  t,
  locale,
  timeZone,
  apiBase,
  canDecide,
}: {
  approvals: (Approval & { task: { id: string; title: string } | null })[];
  t: T;
  locale: string;
  timeZone: string;
  apiBase: string;
  canDecide: boolean;
}) {
  return (
    <ul className="divide-y">
      {approvals.map((a) => {
        const result = a.result as { content?: string } | null;
        return (
          <li key={a.id} className="grid gap-2 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
            <div className="grid gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{a.summary}</span>
                <Badge tone={STATUS_TONE[a.status]}>{t(`approvals.status.${a.status}`)}</Badge>
                <Badge tone={RISK_TONE[a.risk]}>{t(`approvals.risk.${a.risk}`)}</Badge>
                {a.autonomy === "FOUNDER_ONLY" ? <Badge tone="danger">{t("approvals.founderOnly")}</Badge> : null}
              </div>
              <p className="text-xs text-muted-foreground">
                {a.requestedByProfile ? t(`profiles.${a.requestedByProfile}.name`) : t("approvals.unknownRequester")} · {t(`workforce.toolNames.${a.tool}`)} ·{" "}
                {formatDateTime(a.createdAt, locale, timeZone)}
                {a.task ? (
                  <>
                    {" · "}
                    <Link className="hover:underline" href={`/${locale}/tasks/${a.task.id}`}>
                      {a.task.title}
                    </Link>
                  </>
                ) : null}
              </p>
              {a.status === "PENDING" ? <p className="text-xs text-muted-foreground">{t("approvals.expires", { at: formatDateTime(a.expiresAt, locale, timeZone) })}</p> : null}
              {a.decisionNote ? <p className="text-sm">“{a.decisionNote}”</p> : null}
              {a.status === "EXECUTED" && result?.content ? <p className="text-sm text-success">{result.content}</p> : null}
              {a.status === "FAILED" && a.error ? <p className="text-sm text-danger">{a.error}</p> : null}
            </div>
            {a.status === "PENDING" && canDecide ? <ApprovalActions base={`${apiBase}/approvals/${a.id}`} summary={a.summary} /> : null}
          </li>
        );
      })}
    </ul>
  );
}
