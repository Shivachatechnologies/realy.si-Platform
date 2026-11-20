import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight, BookOpen, Crown, Gavel, ListChecks, Play, Workflow } from "lucide-react";
import { ApiButton } from "@/components/command/api-button";
import { CeoAsk } from "@/components/command/ceo-ask";
import { describePriority, tParams } from "@/components/command/ceo-describe";
import { LiveRefresh } from "@/components/command/live-refresh";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { PageHeader } from "@/components/ui/page-header";
import { Figure } from "@/components/ui/scene";
import { getLocale, getT } from "@/i18n/server";
import { formatDate, formatNumber, formatRelativeTime } from "@/i18n/format";
import { isAppError } from "@/server/core/errors";
import { ceoOverview, type CeoOverview } from "@/server/modules/guide/ceo";
import { requireOrgContext } from "@/server/workspace";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("command.ceo.title") };
}

type T = Awaited<ReturnType<typeof getT>>;
type Priority = CeoOverview["priorities"][number];
const OPEN = new Set(["PLANNED", "RUNNING", "REVIEWING"]);
const KNOWN_SKIPS = new Set([
  "maintenance_mode",
  "read_only_mode",
  "platform_ai_disabled",
  "ai_execution_paused",
  "background_jobs_paused",
  "organization_suspended",
  "module_disabled",
  "ai_not_configured",
  "platform_ai_org_disabled",
  "platform_ai_profile_disabled",
  "platform_ai_model_disabled",
  "platform_ai_budget_exhausted",
  "plan_ai_tokens_exhausted",
  "no_ai_ceo",
  "ceo_paused",
  "acting_user_forbidden",
  "already_running",
  "already_ran",
]);
const KNOWN_REASONS = new Set(["delegate", "retry", "follow_up", "stalled_work", "autonomy_suggest_only", "ceo_budget", "daily_cap", "delegation_refused", "objective_off_track", "replan_refused", "approvals_backlog", "profile_unavailable", "founder_approved"]);
const KNOWN_DECISIONS = new Set(["stalled_work", "delegation_proposal", "budget_exhausted", "objective_off_track", "approvals_backlog"]);

const runTone = (s: string) => (s === "COMPLETED" ? "success" : s === "FAILED" ? "danger" : s === "CANCELLED" ? "neutral" : "info") as "success" | "danger" | "neutral" | "info";

const describe = (t: T, locale: string, p: Pick<Priority, "kind" | "params">) => describePriority(t, locale, p);

function RunLink({ t, locale, run }: { t: T; locale: string; run: { id: string; status: string; sessionId: string | null; documentId: string | null } | null }) {
  if (!run) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Badge tone={runTone(run.status)} pulse={OPEN.has(run.status)}>
        {t(`command.ai.runStatus.${run.status}`)}
      </Badge>
      {run.sessionId ? (
        <Link href={`/${locale}/command?s=${run.sessionId}`} className="inline-flex min-h-9 items-center gap-1 text-xs font-medium text-primary hover:underline">
          {t("command.ceo.openRun")} <ArrowUpRight className="size-3 rtl:-scale-x-100" aria-hidden />
        </Link>
      ) : null}
      {run.documentId ? (
        <Link href={`/${locale}/brain/${run.documentId}`} className="inline-flex min-h-9 items-center gap-1 text-xs font-medium text-primary hover:underline">
          <BookOpen className="size-3" aria-hidden /> {t("command.ceo.openDocument")}
        </Link>
      ) : null}
    </span>
  );
}

/** The AI CEO: what it reviewed, this week's priorities, what it delegated and why, outcomes and decisions for the founder. */
export default async function CeoPage() {
  const locale = await getLocale();
  const t = await getT(locale);
  const { viewer, org, company } = await requireOrgContext(locale);
  const header = (actions?: React.ReactNode) => (
    <PageHeader
      variant="editorial"
      world="command"
      eyebrow={
        <Link href={`/${locale}/command`} className="hover:underline">
          {t("guide.command.title")}
        </Link>
      }
      title={t("command.ceo.title")}
      description={t("command.ceo.subtitle")}
      actions={actions}
    />
  );
  if (!company) {
    return (
      <div className="mx-auto grid max-w-[1200px] gap-6">
        {header()}
        <Card className="p-6 text-sm text-muted-foreground">
          {t("guide.noCompany")}{" "}
          <Link href={`/${locale}/onboarding`} className="font-medium text-primary hover:underline">
            {t("guide.noCompanyAction")}
          </Link>
        </Card>
      </div>
    );
  }
  let data: CeoOverview;
  try {
    data = await ceoOverview(viewer.ctx, org.id, company.id);
  } catch (err) {
    if (isAppError(err) && err.code === "forbidden") {
      return (
        <div className="mx-auto grid max-w-[1200px] gap-6">
          {header()}
          <Notice tone="warning">{t("command.ceo.forbidden")}</Notice>
        </div>
      );
    }
    throw err;
  }
  const base = `/api/v1/organizations/${org.id}/companies/${company.id}`;
  const tz = viewer.user.timezone;
  const byId = new Map(data.priorities.map((p) => [p.id, p]));
  const active = data.priorities.filter((p) => p.status === "ACTIVE");
  const closed = data.priorities.filter((p) => p.status !== "ACTIVE");
  const openDecisions = data.decisions.filter((d) => d.status === "OPEN");
  const live = data.priorities.some((p) => p.run && OPEN.has(p.run.status)) || data.cycle?.status === "RUNNING";
  const review = data.cycle?.review ?? {};
  const n = (k: string) => (typeof review[k] === "number" ? (review[k] as number) : null);
  const askDisabled = !data.ai.configured ? t("command.ceo.ask.notConfigured") : !data.canRun ? t("command.ceo.ask.forbidden") : null;
  const role = (profile: string | null) => (profile ? t(`profiles.${profile}.name`) : t("command.ceo.someone"));
  const figures = [
    { key: "healthScore", value: n("healthScore"), href: "/intelligence" },
    { key: "offTrack", value: n("offTrack"), href: "/objectives" },
    { key: "openDeals", value: n("openDeals"), href: "/crm" },
    { key: "overdueInvoices", value: n("overdueInvoices"), href: "/finance/receivables" },
    { key: "pendingApprovals", value: data.pendingApprovals, href: "/approvals" },
    { key: "aiRunning", value: n("aiRunning") === null ? null : (n("aiRunning") ?? 0) + (n("aiQueued") ?? 0), href: "/tasks" },
  ];

  return (
    <div className="mx-auto grid max-w-[1200px] gap-8">
      <LiveRefresh active={live} />
      {header(
        data.canManage && data.ceo ? (
          <ApiButton path={`${base}/guide/ceo/run`} variant="default">
            <Play aria-hidden className="rtl:-scale-x-100" />
            {t("command.ceo.runNow")}
          </ApiButton>
        ) : null,
      )}

      {!data.ceo ? (
        <Notice tone="info" title={t("command.ceo.noCeo.title")} action={<Link href={`/${locale}/workforce`} className="text-sm font-medium text-primary hover:underline">{t("command.ceo.noCeo.action")}</Link>}>
          {t("command.ceo.noCeo.body")}
        </Notice>
      ) : data.ceo.status !== "ACTIVE" ? (
        <Notice tone="warning">{t("command.ceo.paused", { name: data.ceo.name })}</Notice>
      ) : null}
      {!data.ai.configured ? <Notice tone="warning">{t("command.ceo.aiNotConfigured")}</Notice> : null}

      {/* Last review: what the CEO looked at, from the stored snapshot of real numbers. */}
      <Card>
        <CardHeader
          icon={<Crown />}
          title={t("command.ceo.review.title")}
          description={
            data.cycle
              ? t("command.ceo.review.when", { when: formatRelativeTime(data.cycle.completedAt ?? data.cycle.startedAt, locale), trigger: t(`command.ceo.trigger.${data.cycle.trigger === "manual" ? "manual" : "schedule"}`) })
              : t("command.ceo.review.never")
          }
          actions={data.cycle ? <Badge tone={data.cycle.status === "COMPLETED" ? "success" : data.cycle.status === "FAILED" ? "danger" : data.cycle.status === "RUNNING" ? "info" : "warning"}>{t(`command.ceo.cycleStatus.${data.cycle.status}`)}</Badge> : null}
        />
        <CardBody className="grid gap-4">
          {data.cycle?.status === "SKIPPED" || data.cycle?.status === "FAILED" ? (
            <Notice tone="warning">{t(`command.ceo.skip.${data.cycle.skippedReason && KNOWN_SKIPS.has(data.cycle.skippedReason) ? data.cycle.skippedReason : "other"}`)}</Notice>
          ) : null}
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {figures.map((f) => (
              <Link key={f.key} href={`/${locale}${f.href}`} className="rounded-xl border bg-surface-2/40 p-3 hover:border-primary/40">
                <Figure label={t(`command.ceo.figure.${f.key}`)} value={f.value === null ? "—" : formatNumber(f.value, locale)} />
              </Link>
            ))}
          </dl>
          {data.cycle ? (
            <p className="text-xs text-muted-foreground">
              {t("command.ceo.review.counts", { delegated: data.cycle.delegated, followedUp: data.cycle.followedUp, escalated: data.cycle.escalated })} · {t("command.ceo.review.cap", { used: data.caps.usedToday, cap: data.caps.perDay })}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">{t("command.ceo.review.neverHint")}</p>
          )}
          {data.history.length > 1 ? (
            <ol className="flex flex-wrap gap-1.5" aria-label={t("command.ceo.review.history")}>
              {[...data.history].reverse().map((h) => (
                <li key={String(h.day)} title={`${formatDate(h.day, locale, "UTC")} · ${t(`command.ceo.cycleStatus.${h.status}`)}`} className="grid min-w-14 justify-items-center gap-0.5 rounded-md border px-2 py-1 text-[11px]">
                  <span className="text-muted-foreground">{formatDate(h.day, locale, "UTC", { weekday: "short" })}</span>
                  <span className="tabular font-semibold">{h.status === "COMPLETED" ? h.delegated + h.followedUp : "–"}</span>
                </li>
              ))}
            </ol>
          ) : null}
        </CardBody>
      </Card>

      {/* Ask the CEO: starts a real command run the CEO plans and delegates. */}
      <section className="grid gap-3" aria-labelledby="ceo-ask-title">
        <h2 id="ceo-ask-title" className="font-display text-xl tracking-tight">
          {t("command.ceo.ask.title")}
        </h2>
        <p className="text-sm text-muted-foreground">{t("command.ceo.ask.hint")}</p>
        <CeoAsk base={base} disabled={askDisabled} suggestions={[t("command.ceo.ask.s1"), t("command.ceo.ask.s2"), t("command.ceo.ask.s3")]} />
      </section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        {/* This week's priorities. */}
        <Card>
          <CardHeader icon={<ListChecks />} title={t("command.ceo.priorities.title")} description={t("command.ceo.priorities.week", { week: data.weekKey })} />
          <CardBody>
            {active.length ? (
              <ol className="grid gap-3">
                {active.map((p, i) => {
                  const d = describe(t, locale, p);
                  return (
                    <li key={p.id} className="grid gap-2 rounded-xl border bg-surface p-3">
                      <div className="flex items-start gap-3">
                        <span className="grid size-7 shrink-0 place-items-center rounded-full bg-primary/10 font-mono text-xs font-semibold text-primary">{i + 1}</span>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold">{p.href ? <Link href={`/${locale}${p.href}`} className="hover:underline">{d.title}</Link> : d.title}</p>
                          {d.why ? <p className="mt-0.5 text-xs text-muted-foreground">{d.why}</p> : null}
                          <p className="mt-1 text-xs text-muted-foreground">
                            {t("command.ceo.priorities.owner", { role: role(p.profile) })}
                            {p.lastDelegatedAt ? ` · ${t("command.ceo.priorities.delegated", { when: formatRelativeTime(p.lastDelegatedAt, locale) })}` : ` · ${t("command.ceo.priorities.notYet")}`}
                          </p>
                        </div>
                        <Badge tone="accent">{t(`command.ceo.kind.${p.kind}`)}</Badge>
                      </div>
                      <div className="flex flex-wrap items-center justify-between gap-2 ps-10">
                        <RunLink t={t} locale={locale} run={p.run} />
                        {data.canManage ? (
                          <ApiButton path={`${base}/guide/ceo/priorities/${p.id}`} method="PATCH" body={{ status: "DROPPED" }} variant="ghost">
                            {t("command.ceo.priorities.drop")}
                          </ApiButton>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ol>
            ) : (
              <p className="text-sm text-muted-foreground">{data.cycle ? t("command.ceo.priorities.none") : t("command.ceo.priorities.noneYet")}</p>
            )}
            {closed.length ? (
              <details className="mt-4">
                <summary className="min-h-9 cursor-pointer text-xs font-medium text-muted-foreground">{t("command.ceo.priorities.closed", { count: closed.length })}</summary>
                <ul className="mt-2 grid gap-1.5">
                  {closed.map((p) => (
                    <li key={p.id} className="flex flex-wrap items-center gap-2 text-xs">
                      <Badge tone={p.status === "RESOLVED" ? "success" : "neutral"}>{t(`command.ceo.priorityStatus.${p.status}`)}</Badge>
                      <span className="min-w-0 flex-1">{describe(t, locale, p).title}</span>
                      {data.canManage && p.status === "DROPPED" ? (
                        <ApiButton path={`${base}/guide/ceo/priorities/${p.id}`} method="PATCH" body={{ status: "ACTIVE" }} variant="link">
                          {t("command.ceo.priorities.restore")}
                        </ApiButton>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </CardBody>
        </Card>

        {/* Decisions waiting for the founder. */}
        <Card>
          <CardHeader icon={<Gavel />} title={t("command.ceo.decisions.title")} description={t("command.ceo.decisions.hint")} />
          <CardBody className="grid gap-3">
            {data.pendingApprovals ? (
              <Link href={`/${locale}/approvals`} className="flex items-center justify-between gap-2 rounded-xl border border-warning/40 bg-warning/5 p-3 text-sm hover:border-warning">
                <span>{t("command.ceo.decisions.approvals", { count: data.pendingApprovals })}</span>
                <ArrowUpRight className="size-4 rtl:-scale-x-100" aria-hidden />
              </Link>
            ) : null}
            {openDecisions.length ? (
              <ul className="grid gap-3">
                {openDecisions.map((d) => {
                  const p = d.priorityId ? byId.get(d.priorityId) : undefined;
                  const params = tParams(t, d.params);
                  return (
                    <li key={d.id} className="grid gap-2 rounded-xl border bg-surface p-3">
                      <p className="text-sm font-semibold">{KNOWN_DECISIONS.has(d.kind) ? t(`command.ceo.decision.${d.kind}`, { ...params, role: role(typeof params.profile === "string" ? params.profile : null) }) : d.title}</p>
                      {p ? <p className="text-xs text-muted-foreground">{describe(t, locale, p).title}</p> : null}
                      <p className="text-xs text-muted-foreground">{formatRelativeTime(d.createdAt, locale)}</p>
                      <div className="flex flex-wrap items-center gap-2">
                        {data.canManage ? (
                          <>
                            <ApiButton path={`${base}/guide/ceo/decisions/${d.id}`} body={{ decision: "approve" }} variant="default">
                              {t(d.hasProposal ? "command.ceo.decisions.approveStart" : d.kind === "objective_off_track" ? "command.ceo.decisions.replan" : "command.ceo.decisions.acknowledge")}
                            </ApiButton>
                            <ApiButton path={`${base}/guide/ceo/decisions/${d.id}`} body={{ decision: "dismiss" }} variant="ghost">
                              {t("command.ceo.decisions.dismiss")}
                            </ApiButton>
                          </>
                        ) : null}
                        {d.href ? (
                          <Link href={`/${locale}${d.href}`} className="inline-flex min-h-9 items-center text-xs font-medium text-primary hover:underline">
                            {t("command.ceo.decisions.open")}
                          </Link>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : !data.pendingApprovals ? (
              <p className="text-sm text-muted-foreground">{t("command.ceo.decisions.none")}</p>
            ) : null}
          </CardBody>
        </Card>
      </div>

      {/* What the CEO did and why. */}
      <Card>
        <CardHeader icon={<Workflow />} title={t("command.ceo.actions.title")} description={t("command.ceo.actions.hint")} />
        <CardBody>
          {data.actions.length ? (
            <ol className="grid gap-2 border-s ps-4">
              {data.actions.map((a) => {
                const p = a.priorityId ? byId.get(a.priorityId) : undefined;
                const params = tParams(t, a.params);
                return (
                  <li key={a.id} className="relative grid gap-1 py-1">
                    <span aria-hidden className={`absolute -start-[21px] top-2.5 size-2 rounded-full ${a.kind === "HELD" ? "bg-warning" : a.kind === "ESCALATED" || a.kind === "PROPOSED" ? "bg-primary-2" : "bg-primary"}`} />
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <Badge tone={a.kind === "HELD" ? "warning" : a.kind === "ESCALATED" || a.kind === "PROPOSED" ? "info" : "accent"}>{t(`command.ceo.actionKind.${a.kind}`)}</Badge>
                      <span className="font-medium">{p ? describe(t, locale, p).title : a.priority ? a.priority : typeof params.objective === "string" ? params.objective : t("command.ceo.actions.general")}</span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {KNOWN_REASONS.has(a.reason) ? t(`command.ceo.reason.${a.reason}`, { role: role(a.profile), cap: Number(params.cap ?? 0), count: Number(params.count ?? 0), queued: Number(params.queued ?? 0), blocked: Number(params.blocked ?? 0), approvals: Number(params.approvals ?? 0) }) : a.reason} · {formatRelativeTime(a.createdAt, locale)}
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                      <RunLink t={t} locale={locale} run={a.run} />
                      {a.taskId ? (
                        <Link href={`/${locale}/tasks/${a.taskId}`} className="inline-flex min-h-9 items-center gap-1 text-xs font-medium text-primary hover:underline">
                          {a.taskStatus ? t(`guide.task.status.${a.taskStatus}`) : null} · {t("guide.task.open")}
                        </Link>
                      ) : null}
                      {a.run && OPEN.has(a.run.status) && data.canManage && (a.kind === "DELEGATED" || a.kind === "RETRIED" || a.kind === "FOLLOWED_UP") ? (
                        <ApiButton path={`${base}/guide/ceo/runs/${a.run.id}/cancel`} variant="ghost" confirm={t("command.ceo.actions.stopConfirm")}>
                          {t("command.ceo.actions.stop")}
                        </ApiButton>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ol>
          ) : (
            <p className="text-sm text-muted-foreground">{t("command.ceo.actions.none")}</p>
          )}
        </CardBody>
      </Card>

      {/* Outcomes of delegated work. */}
      <Card>
        <CardHeader icon={<BookOpen />} title={t("command.ceo.outcomes.title")} description={t("command.ceo.outcomes.hint")} />
        <CardBody>
          {data.outcomes.length ? (
            <ul className="grid gap-3 sm:grid-cols-2">
              {data.outcomes.map((o) => {
                const p = o.priorityId ? byId.get(o.priorityId) : undefined;
                return (
                  <li key={o.id} className="grid content-start gap-2 rounded-xl border bg-surface p-3">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-semibold">{p ? describe(t, locale, p).title : o.text}</p>
                      <Badge tone={runTone(o.status)}>{t(`command.ai.runStatus.${o.status}`)}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {o.profiles.map((x) => role(x)).join(", ")}
                      {o.completedAt ? ` · ${formatDate(o.completedAt, locale, tz, { dateStyle: "medium", timeStyle: "short" })}` : ""}
                    </p>
                    {o.nextAction ? (
                      <p className="rounded-lg border border-primary/30 bg-primary/5 p-2 text-xs">
                        <span className="font-semibold text-primary">{t("command.ai.nextAction")}: </span>
                        {o.nextAction}
                      </p>
                    ) : null}
                    {o.documentError ? <p className="text-xs text-muted-foreground">{t("command.ceo.outcomes.noDocument")}</p> : null}
                    <RunLink t={t} locale={locale} run={{ id: o.id, status: o.status, sessionId: o.sessionId, documentId: o.documentId }} />
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">{t("command.ceo.outcomes.none")}</p>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
