import Link from "next/link";
import type { ReactNode } from "react";
import { Bot, Brain, CircleDollarSign, FileText, ListChecks, Mail, Megaphone, ShieldAlert, Sparkles, UserPlus, Users } from "lucide-react";
import type { Approval } from "@/generated/prisma/client";
import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/i18n/format";
import type { Translate } from "@/i18n/translate";
import { cn } from "@/lib/utils";
import { DecisionActions, ExpiryCountdown } from "./decision-actions";
import { ApprovalRetry } from "@/components/approvals/approval-actions";

/** Manual + first execution attempts of an approved action (approvals/service.ts MAX_APPROVAL_ATTEMPTS). */
const MAX_APPROVAL_ATTEMPTS = 3;
import type { ActionKind, ActionPreview } from "./describe";

const KIND: Record<ActionKind, { icon: ReactNode; tile: string }> = {
  email: { icon: <Mail />, tile: "bg-info/10 text-info" },
  lead: { icon: <UserPlus />, tile: "bg-success/10 text-success" },
  money: { icon: <CircleDollarSign />, tile: "bg-warning/10 text-warning" },
  post: { icon: <Megaphone />, tile: "bg-primary/10 text-primary" },
  task: { icon: <ListChecks />, tile: "bg-primary/10 text-primary" },
  content: { icon: <FileText />, tile: "bg-primary-2/10 text-primary-2" },
  people: { icon: <Users />, tile: "bg-danger/10 text-danger" },
  memory: { icon: <Brain />, tile: "bg-info/10 text-info" },
  generic: { icon: <Sparkles />, tile: "bg-accent text-accent-foreground" },
};
const RISK_TONE = { LOW: "neutral", MEDIUM: "info", HIGH: "warning", CRITICAL: "danger" } as const;
const STATUS_TONE = { PENDING: "warning", APPROVED: "info", EXECUTED: "success", REJECTED: "neutral", EXPIRED: "neutral", FAILED: "danger" } as const;

export type ApprovalRow = Approval & { task: { id: string; title: string } | null };

/** One request as a clear action preview: what will happen, who asked, how risky it is, and approve / reject. */
export function DecisionCard({
  a,
  preview,
  t,
  locale,
  timeZone,
  apiBase,
  canDecide,
  decidedBy,
}: {
  a: ApprovalRow;
  preview: ActionPreview;
  t: Translate;
  locale: string;
  timeZone: string;
  apiBase: string;
  canDecide: boolean;
  decidedBy?: string | null;
}) {
  const k = KIND[preview.kind];
  const pending = a.status === "PENDING" && a.expiresAt > new Date();
  const result = a.result as { content?: string } | null;
  const requester = a.requestedByProfile ? t(`profiles.${a.requestedByProfile}.name`) : t("approvals.unknownRequester");
  return (
    <article className={cn("reveal grid gap-3 rounded-lg border bg-surface p-4 shadow-elev-1", pending && a.risk !== "LOW" && "border-gradient", pending && "hover-lift")}>
      <div className="flex items-start gap-3">
        <span aria-hidden className={cn("grid size-10 shrink-0 place-items-center rounded-lg [&_svg]:size-5", k.tile)}>
          {k.icon}
        </span>
        <div className="grid min-w-0 flex-1 gap-1">
          <h3 className="text-base font-semibold leading-snug">{preview.sentence}</h3>
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <Bot className="size-3.5" aria-hidden />
              {t("decisionInbox.askedBy", { who: requester })}
            </span>
            {a.task ? (
              <Link className="text-primary hover:underline" href={`/${locale}/tasks/${a.task.id}`}>
                {t("decisionInbox.fromTask", { title: a.task.title })}
              </Link>
            ) : null}
            <span>{formatDateTime(a.createdAt, locale, timeZone)}</span>
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          {!pending ? <Badge tone={STATUS_TONE[a.status]}>{t(`decisionInbox.outcome.${a.status}`)}</Badge> : null}
          <Badge tone={RISK_TONE[a.risk]} shape="pill">
            {t(`approvals.risk.${a.risk}`)}
          </Badge>
        </div>
      </div>

      <Preview preview={preview} t={t} />

      <div className="grid gap-1 rounded-md bg-surface-2/60 px-3 py-2 text-xs">
        <p className="flex items-start gap-1.5">
          <ShieldAlert className={cn("mt-px size-3.5 shrink-0", a.risk === "LOW" ? "text-muted-foreground" : a.risk === "MEDIUM" ? "text-info" : "text-warning")} aria-hidden />
          <span>{t(`decisionInbox.riskExplain.${a.risk}`)}</span>
        </p>
        {a.autonomy === "FOUNDER_ONLY" ? <p className="text-danger">{t("decisionInbox.founderOnly")}</p> : null}
      </div>

      {pending ? (
        <div className="flex flex-wrap items-end justify-between gap-3">
          <ExpiryCountdown expiresAt={a.expiresAt.toISOString()} />
          {canDecide ? <DecisionActions base={`${apiBase}/approvals/${a.id}`} needsMfa={a.risk === "HIGH" || a.risk === "CRITICAL" || a.autonomy === "FOUNDER_ONLY"} /> : <span className="text-xs text-muted-foreground">{t("decisionInbox.cannotDecide")}</span>}
        </div>
      ) : (
        <div className="grid gap-1 text-sm">
          {a.decidedAt ? (
            <p className="text-xs text-muted-foreground">
              {t("decisionInbox.decidedBy", { who: decidedBy ?? t("decisionInbox.someone"), when: formatDateTime(a.decidedAt, locale, timeZone) })}
            </p>
          ) : null}
          {a.decisionNote ? <p className="text-sm">“{a.decisionNote}”</p> : null}
          {a.status === "EXECUTED" && result?.content ? <p className="text-sm text-success">{result.content}</p> : null}
          {a.status === "FAILED" && a.error ? <p className="text-sm text-danger">{a.error}</p> : null}
          {a.status === "FAILED" && canDecide ? <ApprovalRetry base={`${apiBase}/approvals/${a.id}`} attempts={a.attempts} maxAttempts={MAX_APPROVAL_ATTEMPTS} /> : null}
          {a.status === "EXPIRED" ? <p className="text-xs text-muted-foreground">{t("decisionInbox.expiredNote")}</p> : null}
        </div>
      )}
    </article>
  );
}

function Preview({ preview: p, t }: { preview: ActionPreview; t: Translate }) {
  return (
    <div className="grid gap-2">
      {p.amount ? (
        <p className="flex items-baseline gap-2">
          <span className="text-2xl font-semibold tracking-tight tabular-nums">{p.amount}</span>
          {p.lines ? <span className="text-xs text-muted-foreground">{t("decisionInbox.total")}</span> : null}
        </p>
      ) : null}
      {p.message ? (
        <div className="overflow-hidden rounded-md border bg-surface-2/40">
          {p.message.to || p.message.subject ? (
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 border-b px-3 py-2 text-xs">
              {p.message.to ? (
                <>
                  <dt className="text-muted-foreground">{t("decisionInbox.to")}</dt>
                  <dd className="truncate font-medium">{p.message.to}</dd>
                </>
              ) : null}
              {p.message.subject ? (
                <>
                  <dt className="text-muted-foreground">{t("decisionInbox.subject")}</dt>
                  <dd className="truncate font-medium">{p.message.subject}</dd>
                </>
              ) : null}
            </dl>
          ) : null}
          {p.message.body ? (
            <details open={p.message.body.length < 600} className="px-3 py-2">
              <summary className="cursor-pointer text-[11px] text-muted-foreground">{t("approvals.messagePreview")}</summary>
              <p className="mt-1 whitespace-pre-wrap break-words text-sm">{p.message.body}</p>
            </details>
          ) : null}
        </div>
      ) : null}
      {p.lines?.length ? (
        <table className="w-full text-xs">
          <thead className="text-muted-foreground">
            <tr>
              <th className="py-1 text-start font-medium">{t("decisionInbox.fields.description")}</th>
              <th className="py-1 text-end font-medium">{t("decisionInbox.fields.quantity")}</th>
              <th className="py-1 text-end font-medium">{t("decisionInbox.fields.unitPrice")}</th>
              <th className="py-1 text-end font-medium">{t("decisionInbox.total")}</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {p.lines.map((l, i) => (
              <tr key={i}>
                <td className="py-1">{l.description}</td>
                <td className="py-1 text-end tabular-nums">{l.quantity}</td>
                <td className="py-1 text-end tabular-nums">{l.unitPrice}</td>
                <td className="py-1 text-end tabular-nums">{l.total}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {p.facts.length ? (
        <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
          {p.facts.map((f) => (
            <div key={f.label} className="min-w-0">
              <dt className="text-[11px] text-muted-foreground">{f.label}</dt>
              <dd className="break-words">{f.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  );
}
