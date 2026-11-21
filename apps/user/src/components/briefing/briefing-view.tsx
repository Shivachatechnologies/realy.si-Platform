import Link from "next/link";
import type { ReactNode } from "react";
import { AlertTriangle, ArrowUpRight, Bot, CalendarClock, CheckCircle2, Compass, Gavel, Inbox, Lightbulb, Sparkles, TrendingDown, TrendingUp } from "lucide-react";
import { ApprovalActions } from "@/components/approvals/approval-actions";
import { Badge } from "@/components/ui/badge";
import { Figure, Section } from "@/components/ui/scene";
import { formatDate, formatMoney, formatNumber } from "@/i18n/format";
import type { Translate } from "@/i18n/translate";
import { cn } from "@/lib/utils";
import { changeText, decisionText, departmentLabel, insightText, metricText } from "@/server/modules/briefing/format";
import type { BriefingData } from "@/server/modules/briefing/types";

export interface BriefingViewProps {
  data: BriefingData;
  summary: string | null;
  summaryStatus: string;
  t: Translate;
  locale: string;
  apiBase: string;
  /** Approvals that are still pending right now (only those get buttons). */
  pendingIds: Set<string>;
  canDecide: boolean;
}

const RISK_TONE: Record<string, "neutral" | "info" | "warning" | "danger"> = { LOW: "neutral", MEDIUM: "info", HIGH: "warning", CRITICAL: "danger" };

/** The editorial briefing: deterministic sections from BriefingData, with the optional AI summary clearly labelled. */
export function BriefingView({ data: d, summary, summaryStatus, t, locale, apiBase, pendingIds, canDecide }: BriefingViewProps) {
  const L = (path: string) => `/${locale}${path}`;
  const n = (v: number) => formatNumber(v, locale);
  const revenue = d.kpis.find((k) => k.key === "finance.revenue");
  const periodLabel = d.kind === "EVENING" ? t("briefing.sections.today") : d.kind === "WEEKLY" ? t("briefing.sections.week") : t("briefing.sections.yesterday");
  const o = d.output;
  const p = d.problems;

  return (
    <article className="grid gap-10" aria-label={t(`briefing.kinds.${d.kind}`)}>
      {/* Lead: AI summary (labelled) + headline figures */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] lg:items-start">
        <div className="min-w-0">
          {summary ? (
            <div className="relative rounded-2xl border border-world/30 bg-world/5 p-5 animate-fade-up">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <Badge tone="brand" shape="pill">
                  <Sparkles className="size-3" aria-hidden />
                  {t("briefing.aiLabel")}
                </Badge>
                <span className="text-xs text-muted-foreground">{t("briefing.aiHint")}</span>
              </div>
              <p className="font-display text-xl leading-snug text-balance whitespace-pre-line">{summary}</p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{t(`briefing.summaryState.${["pending", "failed", "timeout", "rejected"].includes(summaryStatus) ? summaryStatus : "none"}`)}</p>
          )}
        </div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-5">
          {d.workforce ? <Figure label={t("briefing.figures.aiDone")} value={n(d.workforce.completed)} caption={d.workforce.failed ? t("briefing.line.failedShort", { count: d.workforce.failed }) : periodLabel} /> : null}
          {d.approvals ? <Figure label={t("briefing.figures.waiting")} value={n(d.approvals.pending)} caption={t("briefing.figures.waitingHint")} /> : null}
          {revenue ? <Figure label={t(revenue.labelKey)} value={metricText(revenue, locale, d.currency)} caption={changeText(revenue, locale) ?? periodLabel} /> : null}
          {d.insights && d.insights.healthScore !== null ? <Figure label={t("briefing.figures.health")} value={n(d.insights.healthScore)} caption={t("briefing.figures.healthHint")} /> : null}
        </div>
      </div>

      <div className="grid gap-10 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <div className="grid min-w-0 content-start gap-10">
          {/* 01 AI workforce */}
          <Section index={1} eyebrow={periodLabel} title={t("briefing.sections.workforce")} description={t("briefing.sections.workforceHint")}>
            {d.workforce ? (
              <div className="grid gap-4">
                <div className="flex flex-wrap gap-2 text-sm">
                  <Chip icon={<CheckCircle2 />} tone="success">{t("briefing.line.aiWork", { completed: d.workforce.completed, failed: d.workforce.failed })}</Chip>
                  {d.workforce.inProgress ? <Chip icon={<Bot />}>{t("briefing.view.inProgress", { count: d.workforce.inProgress })}</Chip> : null}
                  <Chip icon={<Gavel />}>{t("briefing.line.actions", { auto: d.workforce.autoExecuted, people: d.workforce.approvedByPeople })}</Chip>
                </div>
                {d.workforce.byDepartment.length ? <DepartmentBars rows={d.workforce.byDepartment} t={t} locale={locale} /> : <p className="text-sm text-muted-foreground">{t("briefing.view.noAiWork")}</p>}
                {d.workforce.highlights.length ? (
                  <ul className="grid gap-1.5">
                    {d.workforce.highlights.map((h) => (
                      <li key={h.id} className="flex items-start gap-2 text-sm">
                        <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
                        <Link href={L(`/tasks/${h.id}`)} className="min-w-0 hover:underline">
                          {h.title}
                          {h.employee ? <span className="text-muted-foreground"> — {h.employee}</span> : null}
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : (
              <Hidden t={t} />
            )}
          </Section>

          {/* 02 Results */}
          <Section index={2} eyebrow={periodLabel} title={t("briefing.sections.results")} description={t("briefing.sections.resultsHint")}>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
              {o.outreachEmails !== null || o.campaignEmails !== null ? <Stat label={t("briefing.view.emailsSent")} value={n((o.outreachEmails ?? 0) + (o.campaignEmails ?? 0))} /> : null}
              {o.postsPublished !== null ? <Stat label={t("briefing.view.postsPublished")} value={n(o.postsPublished)} /> : null}
              {o.calls ? <Stat label={t("briefing.view.calls")} value={n(o.calls)} /> : null}
              {o.meetingsHeld !== null ? <Stat label={t("briefing.view.meetingsHeld")} value={n(o.meetingsHeld)} /> : null}
              {o.newLeads !== null ? <Stat label={t("briefing.view.newLeads")} value={n(o.newLeads)} /> : null}
              {o.dealsWon ? <Stat label={t("briefing.view.dealsWon", { count: o.dealsWon.count })} value={formatMoney({ amountMinor: BigInt(o.dealsWon.amountMinor), currency: d.currency }, locale)} /> : null}
            </dl>
            {d.kpis.length ? (
              <ul className="grid divide-y rounded-xl border bg-surface/60">
                {d.kpis
                  .filter((k) => k.value !== null)
                  .map((k) => {
                    const c = changeText(k, locale);
                    const body = (
                      <>
                        <span className="min-w-0 truncate text-sm">{t(k.labelKey)}</span>
                        <span className="flex items-center gap-2">
                          <span className="font-medium tabular-nums">{metricText(k, locale, d.currency)}</span>
                          {c ? (
                            <span className={cn("inline-flex items-center gap-0.5 text-xs tabular-nums", k.trend === 1 ? "text-success" : k.trend === -1 ? "text-danger" : "text-muted-foreground")}>
                              {k.trend === 1 ? <TrendingUp className="size-3" aria-hidden /> : k.trend === -1 ? <TrendingDown className="size-3" aria-hidden /> : null}
                              {c}
                            </span>
                          ) : null}
                        </span>
                      </>
                    );
                    return (
                      <li key={k.key}>
                        {k.href ? (
                          <Link href={L(k.href)} className="flex items-center justify-between gap-3 px-3 py-2 hover:bg-muted/50">
                            {body}
                          </Link>
                        ) : (
                          <div className="flex items-center justify-between gap-3 px-3 py-2">{body}</div>
                        )}
                      </li>
                    );
                  })}
              </ul>
            ) : null}
          </Section>

          {/* 03 Problems */}
          <Section index={3} eyebrow={periodLabel} title={t("briefing.sections.problems")} description={t("briefing.sections.problemsHint")}>
            {[p.failedTaskCount, p.failedApprovals, p.failedSends, p.failedPosts, p.overdueTasks, p.slaBreaches].some((v) => v) ? (
              <div className="grid gap-3">
                <div className="flex flex-wrap gap-2 text-sm">
                  {p.failedTaskCount ? <Chip icon={<AlertTriangle />} tone="danger" href={L("/tasks?status=FAILED")}>{t("briefing.line.failedTasks", { count: p.failedTaskCount })}</Chip> : null}
                  {p.failedApprovals ? <Chip icon={<AlertTriangle />} tone="danger" href={L("/approvals?outcome=FAILED")}>{t("briefing.line.failedActions", { count: p.failedApprovals })}</Chip> : null}
                  {p.failedSends ? <Chip icon={<AlertTriangle />} tone="warning">{t("briefing.line.failedSends", { count: p.failedSends })}</Chip> : null}
                  {p.failedPosts ? <Chip icon={<AlertTriangle />} tone="warning" href={L("/marketing")}>{t("briefing.line.failedPosts", { count: p.failedPosts })}</Chip> : null}
                  {p.overdueTasks ? <Chip icon={<CalendarClock />} tone="warning" href={L("/projects")}>{t("briefing.line.overdue", { count: p.overdueTasks })}</Chip> : null}
                  {p.slaBreaches ? <Chip icon={<AlertTriangle />} tone="warning" href={L("/support")}>{t("briefing.line.sla", { count: p.slaBreaches })}</Chip> : null}
                </div>
                {p.failedTasks.length ? (
                  <ul className="grid gap-2">
                    {p.failedTasks.map((f) => (
                      <li key={f.id} className="rounded-lg border border-danger/25 bg-danger/5 px-3 py-2 text-sm">
                        <Link href={L(`/tasks/${f.id}`)} className="font-medium hover:underline">
                          {f.title}
                        </Link>
                        {f.error ? <p className="mt-0.5 text-xs text-muted-foreground">{f.error}</p> : null}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : (
              <p className="flex items-center gap-2 text-sm text-success">
                <CheckCircle2 className="size-4" aria-hidden />
                {t("briefing.line.noProblems")}
              </p>
            )}
          </Section>
        </div>

        <aside className="grid min-w-0 content-start gap-10">
          {/* 04 Approvals */}
          <Section index={4} title={t("briefing.sections.approvals")} description={t("briefing.sections.approvalsHint")}>
            {d.approvals ? (
              d.approvals.items.length ? (
                <ul className="grid gap-3">
                  {d.approvals.items.map((a) => {
                    const live = pendingIds.has(a.id);
                    return (
                      <li key={a.id} className={cn("rounded-xl border bg-surface p-3 shadow-elev-1", !live && "opacity-60")}>
                        <div className="mb-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                          <span className="numeral font-semibold text-world">#{a.ref}</span>
                          <Badge tone={RISK_TONE[a.risk] ?? "neutral"}>{t(`briefing.risk.${a.risk}`)}</Badge>
                          {a.needsMfa ? <span>{t("briefing.needsMfa")}</span> : null}
                          {!live ? <span>{t("briefing.view.alreadyDecided")}</span> : <span>{t("briefing.view.expires", { date: formatDate(a.expiresAt, locale, d.timezone, { dateStyle: "medium", timeStyle: "short" }) })}</span>}
                        </div>
                        <p className="text-sm">{a.summary}</p>
                        {live && canDecide ? (
                          <div className="mt-2">
                            <ApprovalActions base={`${apiBase}/approvals/${a.id}`} summary={a.summary} />
                          </div>
                        ) : null}
                      </li>
                    );
                  })}
                  {d.approvals.pending > d.approvals.items.length ? (
                    <Link href={L("/approvals")} className="text-sm text-primary hover:underline">
                      {t("briefing.view.moreApprovals", { count: d.approvals.pending - d.approvals.items.length })}
                    </Link>
                  ) : null}
                </ul>
              ) : (
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Inbox className="size-4" aria-hidden />
                  {t("briefing.view.noApprovals")}
                </p>
              )
            ) : (
              <Hidden t={t} />
            )}
          </Section>

          {/* 05 Today */}
          <Section index={5} title={t(d.kind === "EVENING" ? "briefing.sections.tomorrowish" : "briefing.sections.plan")} description={t("briefing.sections.planHint")}>
            <TodayPlan d={d} t={t} locale={locale} />
          </Section>

          {/* 06 Risks */}
          {d.insights ? (
            <Section index={6} title={t("briefing.sections.risks")} description={t("briefing.sections.risksHint")}>
              {d.insights.items.length ? (
                <ul className="grid gap-2">
                  {d.insights.items.map((i, idx) => (
                    <li key={idx} className="flex items-start gap-2 text-sm">
                      <span aria-hidden className={cn("mt-1.5 size-2 shrink-0 rounded-full", i.severity === "critical" ? "bg-danger" : i.severity === "warning" ? "bg-warning" : "bg-info")} />
                      {i.href ? (
                        <Link href={L(i.href)} className="hover:underline">
                          {insightText(t, i)}
                        </Link>
                      ) : (
                        <span>{insightText(t, i)}</span>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">{t("briefing.view.noRisks")}</p>
              )}
            </Section>
          ) : null}

          {/* 07 Decisions */}
          <Section index={7} title={t("briefing.sections.decisions")} description={t("briefing.sections.decisionsHint")}>
            {d.decisions.length ? (
              <ol className="grid gap-2">
                {d.decisions.map((x, idx) => (
                  <li key={idx}>
                    <Link href={L(x.href)} className="group flex items-start gap-3 rounded-xl border bg-world/5 p-3 hover-lift">
                      <span className="numeral font-display text-2xl leading-none text-world">{idx + 1}</span>
                      <span className="min-w-0 flex-1 text-sm">{decisionText(t, x, locale, d.currency)}</span>
                      <ArrowUpRight className="size-4 shrink-0 text-muted-foreground group-hover:text-foreground rtl:-scale-x-100" aria-hidden />
                    </Link>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Lightbulb className="size-4" aria-hidden />
                {t("briefing.view.noDecisions")}
              </p>
            )}
          </Section>
        </aside>
      </div>
    </article>
  );
}

function Hidden({ t }: { t: Translate }) {
  return (
    <p className="flex items-center gap-2 text-sm text-muted-foreground">
      <Compass className="size-4" aria-hidden />
      {t("briefing.view.hidden")}
    </p>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-micro text-muted-foreground uppercase">{label}</dt>
      <dd className="numeral mt-1 font-display text-2xl">{value}</dd>
    </div>
  );
}

function Chip({ icon, children, tone = "neutral", href }: { icon: ReactNode; children: ReactNode; tone?: "neutral" | "success" | "warning" | "danger"; href?: string }) {
  const cls = cn(
    "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 [&_svg]:size-3.5",
    tone === "success" && "border-success/30 bg-success/8",
    tone === "warning" && "border-warning/35 bg-warning/8",
    tone === "danger" && "border-danger/35 bg-danger/8",
    href && "hover:bg-muted",
  );
  return href ? (
    <Link href={href} className={cls}>
      {icon}
      {children}
    </Link>
  ) : (
    <span className={cls}>
      {icon}
      {children}
    </span>
  );
}

/** Completed vs failed AI tasks per department (inline SVG bars, real counts). */
function DepartmentBars({ rows, t, locale }: { rows: { department: string; completed: number; failed: number }[]; t: Translate; locale: string }) {
  const shown = rows.slice(0, 8);
  const max = Math.max(1, ...shown.map((r) => r.completed + r.failed));
  const label = shown.map((r) => `${departmentLabel(t, r.department)}: ${r.completed} / ${r.failed}`).join("; ");
  return (
    <figure role="img" aria-label={`${t("briefing.view.chartLabel")}: ${label}`} className="grid gap-2.5">
      {shown.map((r) => {
        const wc = (r.completed / max) * 100;
        const wf = (r.failed / max) * 100;
        return (
          <div key={r.department} className="grid gap-1" aria-hidden>
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">{departmentLabel(t, r.department)}</span>
              <span className="tabular-nums">
                {formatNumber(r.completed, locale)}
                {r.failed ? <span className="text-danger"> · {formatNumber(r.failed, locale)}</span> : null}
              </span>
            </div>
            <svg viewBox="0 0 100 6" preserveAspectRatio="none" className="h-1.5 w-full rtl:-scale-x-100">
              <rect x="0" y="0" width="100" height="6" rx="3" className="fill-muted" />
              <rect x="0" y="0" width={wc} height="6" rx="3" className="fill-[var(--world-accent,var(--primary))]" />
              {r.failed ? <rect x={wc} y="0" width={wf} height="6" className="fill-danger" /> : null}
            </svg>
          </div>
        );
      })}
    </figure>
  );
}

function TodayPlan({ d, t, locale }: { d: BriefingData; t: Translate; locale: string }) {
  const td = d.today;
  const counts = [
    td.scheduledPosts ? t("briefing.line.postsToday", { count: td.scheduledPosts }) : null,
    td.sequenceSteps ? t("briefing.line.sequenceSteps", { count: td.sequenceSteps }) : null,
    td.dueTasks ? t("briefing.line.dueTasks", { count: td.dueTasks }) : null,
    td.plansRunning ? t("briefing.view.plansRunning", { count: td.plansRunning }) : null,
  ].filter((x): x is string => !!x);
  const timeline = [
    ...td.meetings.map((m) => ({ at: m.startsAt, label: m.title, tag: t(`briefing.view.meeting.${m.kind}`) })),
    ...td.campaigns.map((c) => ({ at: c.scheduledAt, label: c.name, tag: t("briefing.view.campaign") })),
  ].sort((a, b) => a.at.localeCompare(b.at));
  if (!timeline.length && !counts.length && !td.aiSchedules.length) return <p className="text-sm text-muted-foreground">{t("briefing.line.nothingScheduled")}</p>;
  return (
    <div className="grid gap-4">
      {timeline.length ? (
        <ol className="relative grid gap-3 border-s ps-4">
          {timeline.map((e, i) => (
            <li key={i} className="relative text-sm">
              <span aria-hidden className="absolute -start-[21px] top-1.5 size-2.5 rounded-full border-2 border-surface bg-[var(--world-accent,var(--primary))]" />
              <span className="me-2 font-medium tabular-nums">{formatDate(e.at, locale, d.timezone, { timeStyle: "short" })}</span>
              {e.label}
              <span className="ms-2 text-xs text-muted-foreground">{e.tag}</span>
            </li>
          ))}
        </ol>
      ) : null}
      {td.aiSchedules.length ? (
        <div>
          <p className="mb-1 text-micro text-muted-foreground uppercase">{t("briefing.view.aiRoutines")}</p>
          <ul className="flex flex-wrap gap-1.5">
            {td.aiSchedules.map((s, i) => (
              <li key={i}>
                <Badge tone="accent" shape="pill">
                  <Bot className="size-3" aria-hidden />
                  {s.timeOfDay ? `${s.timeOfDay} · ` : ""}
                  {s.name}
                </Badge>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {counts.length ? <p className="text-sm text-muted-foreground">{counts.join(" · ")}</p> : null}
    </div>
  );
}
