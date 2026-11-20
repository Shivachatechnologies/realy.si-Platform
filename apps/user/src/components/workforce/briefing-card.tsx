import Link from "next/link";
import { AlertTriangle, Bot, CalendarCheck, Gavel, LineChart, ListChecks, Megaphone, ShieldAlert } from "lucide-react";
import type { ReactNode } from "react";
import { TaskStatusBadge } from "@/components/agents/status-badge";
import { IssueList } from "@/components/bi/issue-list";
import { formatChange, formatMetric } from "@/components/bi/format";
import { Badge } from "@/components/ui/badge";
import type { AgentTaskStatus } from "@/generated/prisma/enums";
import type { Translate } from "@/i18n/translate";
import { formatNumber, formatRelativeTime } from "@/i18n/format";
import type { BriefingSections, CardMetric } from "@/server/modules/workforce/briefing-card";
import { cn } from "@/lib/utils";

const eventLabel = (t: Translate, type: string) => {
  const k = `workflows.events.${type.replace(/\./g, "_")}`;
  const l = t(k);
  return l === k ? type : l;
};

function Section({ icon, title, children, className }: { icon: ReactNode; title: string; children: ReactNode; className?: string }) {
  return (
    <section className={cn("grid content-start gap-2 rounded-md border p-3", className)}>
      <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {icon}
        {title}
      </h3>
      {children}
    </section>
  );
}

function Metrics({ items, t, locale, currency }: { items: CardMetric[]; t: Translate; locale: string; currency: string }) {
  if (!items.length) return <p className="text-sm text-muted-foreground">{t("intelligence.card.noData")}</p>;
  return (
    <dl className="grid gap-1 text-sm">
      {items.map((m) => (
        <div key={m.key} className="flex items-baseline justify-between gap-2">
          <dt className="truncate text-muted-foreground">{m.href ? <Link className="hover:underline" href={`/${locale}${m.href}`}>{t(m.labelKey)}</Link> : t(m.labelKey)}</dt>
          <dd className="flex items-baseline gap-2 tabular">
            <span className="font-medium">{formatMetric(m.value, m.unit, locale, currency, { compact: true })}</span>
            <span className={cn("text-[11px]", m.trend === 1 ? "text-success" : m.trend === -1 ? "text-danger" : "text-muted-foreground")}>{formatChange(m.changePct, locale) ?? "—"}</span>
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** The structured daily briefing (deterministic, from the company's data) shown next to the AI narrative. */
export function BriefingCard({ s, t, locale }: { s: BriefingSections; t: Translate; locale: string }) {
  const n = (v: number | null) => (v === null ? "—" : formatNumber(v, locale));
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      <Section icon={<CalendarCheck aria-hidden className="size-4" />} title={t("intelligence.card.priorities")} className="md:col-span-2">
        {s.priorities.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("intelligence.card.noPriorities")}</p>
        ) : (
          <ol className="grid list-decimal gap-1 ps-5 text-sm">
            {s.priorities.map((p, i) => (
              <li key={i}>
                <Link className="hover:underline" href={`/${locale}${p.href}`}>
                  {p.kind === "critical_issue"
                    ? t("intelligence.card.prio.critical_issue", { issue: t(`intelligence.issues.${p.params.kind}`, { ...p.params, ...(typeof p.params.metric === "string" ? { metric: t(p.params.metric) } : {}) }) })
                    : p.kind === "growth_insight"
                      ? t("intelligence.card.prio.growth_insight", { signal: t(`growth.signals.${p.params.signal}.title`) })
                      : t(`intelligence.card.prio.${p.kind}`, p.params)}
                </Link>
              </li>
            ))}
          </ol>
        )}
      </Section>
      <Section icon={<Gavel aria-hidden className="size-4" />} title={t("intelligence.card.decisions")} className="md:col-span-2">
        {!s.decisions ? (
          <p className="text-sm text-muted-foreground">{t("intelligence.card.noAccess")}</p>
        ) : s.decisions.pending === 0 && !s.decisions.growth.length ? (
          <p className="text-sm text-muted-foreground">{t("intelligence.card.noDecisions")}</p>
        ) : (
          <ul className="grid gap-1 text-sm">
            {s.decisions.approvals.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-2">
                <Link className="min-w-0 truncate hover:underline" href={`/${locale}/approvals`}>
                  {a.summary}
                </Link>
                <Badge tone={a.risk === "HIGH" || a.risk === "CRITICAL" ? "danger" : "warning"}>{a.risk}</Badge>
              </li>
            ))}
            {s.decisions.pending > s.decisions.approvals.length ? <li className="text-xs text-muted-foreground">{t("intelligence.card.moreApprovals", { count: s.decisions.pending - s.decisions.approvals.length })}</li> : null}
            {s.decisions.growth.map((g) => (
              <li key={g.id}>
                <Link className="hover:underline" href={`/${locale}/intelligence/growth`}>
                  {t(`growth.signals.${g.signal}.title`)}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section icon={<LineChart aria-hidden className="size-4" />} title={t("intelligence.card.performance")}>
        <Metrics items={s.performance} t={t} locale={locale} currency={s.currency} />
      </Section>
      <Section icon={<Megaphone aria-hidden className="size-4" />} title={t("intelligence.card.updates")}>
        <div className="grid gap-2">
          {(["revenue", "sales", "marketing"] as const).map((k) => (
            <div key={k} className="grid gap-1">
              <h4 className="text-[11px] font-medium text-muted-foreground">{t(`intelligence.card.update.${k}`)}</h4>
              <Metrics items={s.updates[k]} t={t} locale={locale} currency={s.currency} />
            </div>
          ))}
        </div>
      </Section>
      <Section icon={<Bot aria-hidden className="size-4" />} title={t("intelligence.card.aiWork")}>
        {!s.aiWork ? (
          <p className="text-sm text-muted-foreground">{t("intelligence.card.noAccess")}</p>
        ) : (
          <>
            <p className="text-sm">{t("intelligence.card.aiWorkCounts", { completed: s.aiWork.completed, inProgress: s.aiWork.inProgress, failed: s.aiWork.failed })}</p>
            <ul className="grid gap-1 text-sm">
              {s.aiWork.recent.map((x) => (
                <li key={x.id} className="flex items-center justify-between gap-2">
                  <Link className="min-w-0 truncate hover:underline" href={`/${locale}/tasks/${x.id}`}>
                    {x.title}
                  </Link>
                  <TaskStatusBadge status={x.status as AgentTaskStatus} label={t(`agentTasks.status.${x.status}`)} />
                </li>
              ))}
            </ul>
          </>
        )}
      </Section>
      <Section icon={<ListChecks aria-hidden className="size-4" />} title={t("intelligence.card.events")}>
        {!s.events ? (
          <p className="text-sm text-muted-foreground">{t("intelligence.card.noAccess")}</p>
        ) : s.events.total === 0 ? (
          <p className="text-sm text-muted-foreground">{t("intelligence.card.noEvents")}</p>
        ) : (
          <>
            <ul className="flex flex-wrap gap-1">
              {s.events.byType.map((e) => (
                <li key={e.type}>
                  <Badge>
                    {eventLabel(t, e.type)} · {formatNumber(e.count, locale)}
                  </Badge>
                </li>
              ))}
            </ul>
            <ul className="grid gap-0.5 text-xs text-muted-foreground">
              {s.events.latest.map((e, i) => (
                <li key={i}>
                  {eventLabel(t, e.type)} · {formatRelativeTime(new Date(e.at), locale)}
                </li>
              ))}
            </ul>
          </>
        )}
      </Section>
      <Section icon={<ShieldAlert aria-hidden className="size-4" />} title={t("intelligence.card.risks")} className="md:col-span-2">
        <IssueList issues={s.risks} t={t} locale={locale} emptyLabel={t("intelligence.noIssues")} />
      </Section>
      <Section icon={<AlertTriangle aria-hidden className="size-4" />} title={t("intelligence.card.blockers")} className="md:col-span-2">
        <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
          {(
            [
              ["overdueTasks", s.blockers.overdueTasks, "/projects"],
              ["overdueMilestones", s.blockers.overdueMilestones, "/objectives"],
              ["failedRuns", s.blockers.failedRuns, "/tasks?status=FAILED"],
              ["slaBreaches", s.blockers.slaBreaches, "/support"],
            ] as const
          ).map(([k, v, href]) => (
            <div key={k} className="rounded-md bg-surface-2 p-2">
              <dt className="text-[11px] text-muted-foreground">{t(`intelligence.card.blocker.${k}`)}</dt>
              <dd className={cn("tabular text-lg font-semibold", v ? "text-danger" : undefined)}>
                {v ? (
                  <Link className="hover:underline" href={`/${locale}${href}`}>
                    {n(v)}
                  </Link>
                ) : (
                  n(v)
                )}
              </dd>
            </div>
          ))}
        </dl>
      </Section>
    </div>
  );
}
