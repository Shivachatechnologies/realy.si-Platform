import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { ArrowUpRight, CalendarClock, CheckCircle2, Circle, ListTodo, PhoneCall, Sparkles } from "lucide-react";
import { Badge, StatusDot } from "@/components/ui/badge";
import { ProgressBar } from "@/components/objectives/progress";
import { Button } from "@/components/ui/button";
import { ObjectiveBar } from "@/components/command/objective-bar";
import { MarkReadButton } from "@/components/command/mark-read-button";
import { listMyNotifications } from "@/server/modules/notifications/service";
import { LiveClock } from "@/components/live-clock";
import { getLocale, getT } from "@/i18n/server";
import { displayName, formatDate, formatList, formatNumber, formatRelativeTime } from "@/i18n/format";
import { db } from "@/server/core/db";
import { redis } from "@/server/core/rate-limit";
import { listAuditLogs } from "@/server/modules/audit/service";
import { formatMetric } from "@/components/bi/format";
import { resolveRange } from "@/server/modules/bi/range";
import { metricContext, metricSeries, metricValues, type MetricValue } from "@/server/modules/bi/service";
import type { MetricDefinition, MetricScope } from "@/server/core/metrics";
import { World } from "@/components/ui/world";
import { Section } from "@/components/ui/scene";
import { CommandHero } from "@/components/command/command-hero";
import { CommandEntry } from "@/components/command/command-entry";
import { CommandCenterNextActions } from "@/components/command/next-actions-slot";
import { KpiRibbon } from "@/components/command/kpi-ribbon";
import { aiWorkload, companyUniverse, latestRecommendations, liveActivity } from "@/components/command/universe-data";
import { OperatingStrip } from "@/components/command/operating-strip";
import { CompanyUniverse } from "@/components/graphics/company-universe";
import { GrowthChart } from "@/components/graphics/growth-chart";
import { WorldIllustration } from "@/components/graphics/illustrations";
import { AiAvatar } from "@/components/graphics/ai-avatar";
import { aiConfigured } from "@/server/modules/agents/runtime";
import { commandCounters, goalsProgress, myToday } from "@/server/modules/objectives/overview";
import { can } from "@/server/modules/rbac/service";
import { companyChain } from "@/server/modules/rbac/scope";
import { requireOrgContext } from "@/server/workspace";
import { journeyEntry } from "@/server/modules/builder/journey";
import { businessHealth } from "@/server/modules/bi/health";
import { liveCommandRuns } from "@/server/modules/guide/command";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("command.title") };
}

async function health(orgId: string) {
  const [database, queue, backlog] = await Promise.all([
    db().$queryRaw`SELECT 1`.then(() => true, () => false),
    redis().ping().then((r) => r === "PONG", () => false),
    db().event.count({ where: { organizationId: orgId, publishedAt: null } }).catch(() => null),
  ]);
  return { database, queue, backlog };
}

/** Department order for the Command Center KPI strip (most business-critical first). */
const KPI_ORDER = ["finance", "sales", "marketing", "support", "projects", "hr", "operations", "executive", "ai"];

/** Up to 8 KPIs for the last 30 days vs the previous 30, plus the growth metric definition; null when the viewer may not read analytics. */
async function businessKpis(ctx: Parameters<typeof can>[0], orgId: string, companyId: string | null, chain: Awaited<ReturnType<typeof companyChain>> | null): Promise<{ values: MetricValue[]; currency: string; scope: MetricScope; growth: MetricDefinition | null } | null> {
  if (!companyId || !chain || !(await can(ctx, "analytics.read", chain))) return null;
  const { scope, metrics } = await metricContext(ctx, orgId, companyId);
  const picked = [...metrics].sort((a, b) => KPI_ORDER.indexOf(a.department) - KPI_ORDER.indexOf(b.department)).slice(0, 8);
  // The growth graph follows revenue when visible, else the first money flow, else the first flow metric.
  const growth = metrics.find((m) => m.key === "finance.revenue") ?? metrics.find((m) => m.unit === "money" && m.kind === "flow") ?? metrics.find((m) => m.kind === "flow") ?? null;
  return { values: await metricValues(picked, scope, resolveRange("30d")), currency: scope.currency, scope, growth };
}

export default async function CommandCenterPage() {
  const locale = await getLocale();
  const t = await getT(locale);
  const { viewer, org, company } = await requireOrgContext(locale);

  // New founders (no company yet, or an unfinished onboarding journey) go to the guided journey, not an empty dashboard.
  const companyCount = company ? 1 : await db().company.count({ where: { organizationId: org.id, deletedAt: null } });
  const journey = await journeyEntry(viewer.user.id, org.id, companyCount);
  if (journey) redirect(`/${locale}${journey}`);

  // Real counts from the company's records, each shown only to viewers allowed to read that area.
  const chain = company ? await companyChain(db(), org.id, company.id) : null;
  const tz = viewer.user.timezone;
  const [activity, status, billing, memberCount, counters, notifications, kpis, goals, today, canManageObjectives, canRunAgents, workload, tasks, recs] = await Promise.all([
    listAuditLogs(viewer.ctx, org.id, { limit: 8 }).catch(() => null),
    health(org.id),
    db().billingProfile.findUnique({ where: { organizationId: org.id }, select: { billingCountryConfirmedAt: true } }),
    db().membership.count({ where: { organizationId: org.id, status: "ACTIVE" } }),
    company && chain ? commandCounters(viewer.ctx, org.id, company.id, chain) : Promise.resolve([]),
    listMyNotifications(viewer.ctx, org.id, { unreadOnly: true, limit: 10 }),
    businessKpis(viewer.ctx, org.id, company?.id ?? null, chain),
    company && chain ? goalsProgress(viewer.ctx, org.id, company.id, chain).catch(() => null) : Promise.resolve(null),
    company && chain ? myToday(viewer.ctx, org.id, company.id, chain, tz) : Promise.resolve(null),
    chain ? can(viewer.ctx, "objectives.manage", chain) : Promise.resolve(false),
    chain ? can(viewer.ctx, "agents.run", chain) : Promise.resolve(false),
    company && chain ? aiWorkload(viewer.ctx, org.id, company.id, chain).catch(() => null) : Promise.resolve(null),
    company && chain ? liveActivity(viewer.ctx, org.id, company.id, chain).catch(() => []) : Promise.resolve([]),
    company && chain ? latestRecommendations(viewer.ctx, org.id, company.id, chain).catch(() => null) : Promise.resolve(null),
  ]);
  const fmt = (m: MetricValue) => formatMetric(m.value, m.unit, locale, kpis?.currency ?? company?.baseCurrency ?? "USD", { compact: true });
  const [universe, series] = await Promise.all([
    company && chain ? companyUniverse(viewer.ctx, org.id, company.id, chain, { companyName: company.name, locale, t, kpis, fmt }).catch(() => null) : Promise.resolve(null),
    kpis?.growth ? metricSeries(kpis.growth, kpis.scope, resolveRange("90d"), 13).catch(() => null) : Promise.resolve(null),
  ]);
  const base = company ? `/api/v1/organizations/${org.id}/companies/${company.id}` : null;
  // The operating layer: AI commands in flight, proposals waiting for a decision, explainable business health.
  const now = new Date();
  const [runs, canReadApprovals, canDecide] = company && chain
    ? await Promise.all([liveCommandRuns(viewer.ctx, org.id, company.id, 4).catch(() => null), can(viewer.ctx, "approvals.read", chain), can(viewer.ctx, "approvals.decide", chain)])
    : [null, false, false];
  const [pendingApprovals, bizHealth] = company && chain
    ? await Promise.all([
        canReadApprovals
          ? db().approval.findMany({ where: { organizationId: org.id, companyId: company.id, status: "PENDING", expiresAt: { gt: now } }, orderBy: { expiresAt: "asc" }, take: 4, select: { id: true, summary: true, risk: true, expiresAt: true, taskId: true } })
          : Promise.resolve(null),
        kpis ? businessHealth(viewer.ctx, org.id, company.id).catch(() => null) : Promise.resolve(null),
      ])
    : [null, null];
  const runBlocked = !aiConfigured() ? t("guide.ai.notConfigured") : !canRunAgents ? t("guide.ai.forbidden") : null;
  const canPlan = canManageObjectives && canRunAgents && aiConfigured();
  const planNote = canManageObjectives && !canPlan ? (aiConfigured() ? t("objectives.plan.noRunPermission") : t("objectives.plan.aiNotConfigured")) : null;
  const pct = (v: number | null) => (v === null ? "—" : formatNumber(v, locale, { style: "percent", maximumFractionDigits: 0 }));
  const time = (d: Date) => new Intl.DateTimeFormat(locale, { timeStyle: "short", timeZone: tz }).format(d);
  const hour = Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone: tz }).format(new Date()));
  const greeting = t(hour < 12 ? "dna.command.morning" : hour < 18 ? "dna.command.afternoon" : "dna.command.evening", { name: viewer.user.name.split(" ")[0] ?? "" });
  const approvals = counters.find((c) => c.key === "approvals")?.value ?? null;

  const country = (code: string | null) => (code ? displayName(code, "region", locale) : t("command.notSet"));
  const setup = [
    { key: "company", done: !!company, href: "/company" },
    { key: "billing", done: !!billing?.billingCountryConfirmedAt, href: "/settings/billing" },
    { key: "mfa", done: viewer.user.mfaEnabled, href: "/settings/security" },
    { key: "team", done: memberCount > 1, href: "/settings/members" },
  ];
  const setupDone = setup.filter((s) => s.done).length;
  const growthData =
    series && kpis?.growth
      ? series.map((p) => ({
          label: new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(p.from)),
          value: p.value,
          display: formatMetric(p.value, kpis.growth!.unit, locale, kpis.currency),
        }))
      : null;
  const growthTotal = series?.reduce((a, p) => a + (p.value ?? 0), 0) ?? null;
  const healthy = status.database && status.queue && (status.backlog ?? 0) <= 100;
  const statusTone = (s: string) => (s === "RUNNING" ? ("success" as const) : s === "QUEUED" ? ("info" as const) : s === "FAILED" ? ("danger" as const) : ("neutral" as const));

  return (
    <World name="command" ambient={false}>
      <div className="mx-auto grid max-w-[1440px] gap-10">
        <CommandHero
          locale={locale}
          workload={workload}
          eyebrow={
            <span className="inline-flex flex-wrap items-center gap-x-2">
              {company ? company.name : t("command.title")}
              {company ? (
                <span className="font-normal tracking-normal normal-case text-muted-foreground">
                  · <LiveClock timeZone={company.timezone} />
                </span>
              ) : null}
            </span>
          }
          headline={
            <>
              {greeting} <span className="text-world italic">{t("dna.command.headlineTail")}</span>
            </>
          }
          sub={
            workload
              ? t("dna.command.sub", { running: workload.running, queued: workload.queued, approvals: approvals ?? 0 })
              : t("dna.command.subNoAi")
          }
        >
          <div className="grid gap-3">
            <CommandEntry locale={locale} />
            <ObjectiveBar base={base} locale={locale} canManage={canManageObjectives} canPlan={canPlan} note={planNote} />
          </div>
        </CommandHero>

        {company ? (
          <Section index={0} eyebrow={t("dna.command.nextEyebrow")} title={t("dna.command.nextTitle")}>
            <CommandCenterNextActions organizationId={org.id} companyId={company.id} locale={locale} />
          </Section>
        ) : null}

        {company && base ? (
          <OperatingStrip t={t} locale={locale} base={base} runs={runs} approvals={pendingApprovals} canDecide={canDecide} health={bizHealth} runBlocked={runBlocked} />
        ) : null}

        {notifications.length ? (
          <section aria-label={t("notifications.title")} className="panel-float flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
            <span className="flex items-center gap-2 text-sm font-medium">
              <span className="live-dot text-primary" data-pulse="true" aria-hidden />
              {t("notifications.title")}
              <Badge tone="accent">{notifications.length}</Badge>
            </span>
            <ul className="mask-fade-x flex min-w-0 flex-1 gap-4 overflow-x-auto text-sm">
              {notifications.slice(0, 5).map((n) => {
                const p = n.payload as { summary?: string; title?: string; href?: string };
                const href = n.type === "approval.requested" ? "/approvals" : p.href?.startsWith("/") ? p.href : "";
                return (
                  <li key={n.id} className="shrink-0">
                    <Link className="hover:underline" href={`/${locale}${href}`}>
                      {n.type === "approval.requested" ? t("notifications.approvalRequested", { summary: p.summary ?? "" }) : t(`notifications.kinds.${n.type}`, { title: p.title ?? "" })}
                    </Link>
                  </li>
                );
              })}
            </ul>
            <span className="flex items-center gap-2">
              <Link href={`/${locale}/notifications`} className="text-xs text-muted-foreground hover:underline">
                {t("notifications.viewAll")}
              </Link>
              <MarkReadButton organizationId={org.id} />
            </span>
          </section>
        ) : null}

        {/* Business pulse: editorial KPI ribbon */}
        <Section
          index={1}
          eyebrow={kpis ? t("command.kpisLast30") : undefined}
          title={t("command.business")}
          action={
            kpis ? (
              <Link href={`/${locale}/analytics`} className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
                {t("command.openAnalytics")}
                <ArrowUpRight className="size-3.5 rtl:-scale-x-100" aria-hidden />
              </Link>
            ) : null
          }
        >
          {kpis === null ? (
            <p className="text-sm text-muted-foreground">{company ? t("command.kpisForbidden") : t("command.noCompany")}</p>
          ) : kpis.values.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("command.kpisEmpty")}</p>
          ) : (
            <div className="overflow-hidden rounded-2xl border bg-surface/60 backdrop-blur">
              <KpiRibbon
                currency={kpis.currency}
                metrics={kpis.values.map((m) => ({ key: m.key, label: t(m.labelKey), value: m.value, unit: m.unit, changePct: m.changePct, trend: m.trend, href: m.href ? `/${locale}${m.href}` : `/${locale}/analytics` }))}
              />
            </div>
          )}
        </Section>

        {/* The company universe + growth & health */}
        {company ? (
          <div className="grid gap-8 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
            <Section index={2} eyebrow={t("dna.universe.eyebrow")} title={t("dna.universe.title")} description={t("dna.universe.description")}>
              {universe && universe.nodes.length > 1 ? (
                <div className="relative overflow-hidden rounded-3xl border bg-[radial-gradient(ellipse_at_center,color-mix(in_oklch,var(--primary)_8%,var(--surface)),var(--surface)_70%)] p-3">
                  <CompanyUniverse nodes={universe.nodes} links={universe.links} height={520} />
                </div>
              ) : (
                <div className="grid place-items-center gap-3 rounded-3xl border border-dashed p-10 text-center">
                  <WorldIllustration world="command" className="w-56" />
                  <p className="max-w-md text-sm text-muted-foreground">{t("dna.universe.empty")}</p>
                  <div className="flex flex-wrap justify-center gap-2">
                    <Button asChild size="sm">
                      <Link href={`/${locale}/builder`}>{t("dna.universe.build")}</Link>
                    </Button>
                    <Button asChild size="sm" variant="secondary">
                      <Link href={`/${locale}/workforce`}>{t("dna.universe.hire")}</Link>
                    </Button>
                  </div>
                </div>
              )}
            </Section>

            <div className="grid content-start gap-8">
              <Section index={3} eyebrow={kpis?.growth ? t(kpis.growth.labelKey) : undefined} title={t("dna.command.growth")}>
                {growthData && growthData.some((d) => d.value !== null) ? (
                  <div className="grid gap-3">
                    <div className="flex items-baseline gap-3">
                      <span className="numeral font-display text-numeral">{formatMetric(growthTotal, kpis!.growth!.unit, locale, kpis!.currency, { compact: true })}</span>
                      <span className="text-xs text-muted-foreground">{t("dna.command.last90")}</span>
                    </div>
                    <GrowthChart data={growthData} ariaLabel={t("dna.command.growthAria", { metric: t(kpis!.growth!.labelKey) })} />
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">{kpis ? t("dna.command.growthEmpty") : company ? t("command.kpisForbidden") : t("command.noCompany")}</p>
                )}
              </Section>

              <Section index={4} title={t("dna.command.health")}>
                <div className="grid gap-3 rounded-2xl border bg-surface/60 p-4">
                  <div className="flex items-center gap-3">
                    <span className={healthy ? "live-dot text-success" : "live-dot text-warning"} data-pulse="true" aria-hidden />
                    <span className="font-medium">{healthy ? t("dna.command.healthy") : t("dna.command.degraded")}</span>
                  </div>
                  <ul className="grid gap-2 text-sm">
                    {(["database", "queue"] as const).map((k) => (
                      <li key={k} className="flex items-center gap-2">
                        <StatusDot tone={status[k] ? "success" : "danger"} />
                        <span>{t(`command.health.${k}`)}</span>
                        <span className="ms-auto text-xs text-muted-foreground">{t(status[k] ? "command.health.ok" : "command.health.fail")}</span>
                      </li>
                    ))}
                    <li className="flex items-center gap-2">
                      <StatusDot tone={status.backlog === null ? "danger" : status.backlog > 100 ? "warning" : "success"} />
                      <span>{t("command.health.backlog")}</span>
                      <span className="numeral ms-auto font-mono text-xs">{status.backlog ?? "—"}</span>
                    </li>
                  </ul>
                  {counters.length ? (
                    <div className="grid grid-cols-3 gap-2 border-t pt-3">
                      {counters.slice(0, 6).map((c) => (
                        <Link key={c.key} href={`/${locale}${c.href}`} className="rounded-lg px-1 py-1 hover:bg-muted/60">
                          <div className="numeral font-display text-2xl leading-none">{formatNumber(c.value, locale)}</div>
                          <div className="mt-1 truncate text-[11px] text-muted-foreground">{t(`command.counters.${c.key}`)}</div>
                        </Link>
                      ))}
                    </div>
                  ) : null}
                </div>
              </Section>
            </div>
          </div>
        ) : null}

        {/* Strategy, AI recommendations, live activity */}
        {company ? (
          <div className="grid gap-8 lg:grid-cols-3">
            <Section
              index={5}
              title={t("dna.command.priorities")}
              action={
                goals ? (
                  <Link href={`/${locale}/company/strategy`} className="text-xs text-primary hover:underline">
                    {t("command.goals.open")}
                  </Link>
                ) : null
              }
            >
              {goals === null ? (
                <p className="text-sm text-muted-foreground">{t("command.goals.forbidden")}</p>
              ) : goals.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("command.goals.empty")}</p>
              ) : (
                <ol className="grid gap-4">
                  {goals.map((g, i) => (
                    <li key={g.id} className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                      <span className="numeral row-span-3 font-display text-3xl leading-none text-world">{String(i + 1).padStart(2, "0")}</span>
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <Link href={`/${locale}/objectives?goal=${g.id}`} className="min-w-0 flex-1 truncate font-medium hover:underline">
                          {g.title}
                        </Link>
                        <span className="numeral text-xs text-muted-foreground">{pct(g.progress)}</span>
                      </div>
                      <ProgressBar value={g.progress} label={g.title} />
                      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        {[t("command.goals.objectives", { count: g.objectives }), g.targetDate ? formatDate(g.targetDate, locale, "UTC") : null].filter(Boolean).join(" · ")}
                        {g.planPending ? (
                          <Link href={`/${locale}/objectives/plan/${g.id}`}>
                            <Badge tone="accent">{t("command.goals.planPending")}</Badge>
                          </Link>
                        ) : null}
                        {g.atRisk ? <Badge tone="warning">{t("command.goals.atRisk", { count: g.atRisk })}</Badge> : null}
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </Section>

            <Section index={6} title={t("dna.command.recommendations")}>
              {recs === null ? (
                <p className="text-sm text-muted-foreground">{t("dna.command.recsForbidden")}</p>
              ) : recs.issues.length === 0 ? (
                <div className="grid justify-items-start gap-3 rounded-2xl border border-dashed p-4">
                  <Sparkles className="size-5 text-primary" aria-hidden />
                  <p className="text-sm text-muted-foreground">{recs.briefing ? t("dna.command.recsClear") : t("dna.command.recsNone")}</p>
                  <Button asChild size="sm" variant="secondary">
                    <Link href={`/${locale}/intelligence`}>{t("dna.command.recsOpen")}</Link>
                  </Button>
                </div>
              ) : (
                <ul className="grid gap-2">
                  {recs.issues.map((i, k) => (
                    <li key={k} className="relative overflow-hidden rounded-xl border bg-surface/70 p-3 ps-4 text-sm">
                      <span aria-hidden className={`absolute inset-y-0 start-0 w-1 ${i.severity === "high" || i.severity === "critical" ? "bg-danger" : i.severity === "medium" ? "bg-warning" : "bg-info"}`} />
                      {i.href?.startsWith("/") ? (
                        <Link href={`/${locale}${i.href}`} className="hover:underline">
                          {i.message}
                        </Link>
                      ) : (
                        i.message
                      )}
                    </li>
                  ))}
                  {recs.briefing ? (
                    <li className="text-xs text-muted-foreground">
                      {t("dna.command.recsFrom", { when: formatRelativeTime(recs.briefing.createdAt, locale) })}
                      {recs.briefing.taskId ? (
                        <>
                          {" · "}
                          <Link className="text-primary hover:underline" href={`/${locale}/tasks/${recs.briefing.taskId}`}>
                            {t("dna.command.recsTask")}
                          </Link>
                        </>
                      ) : null}
                    </li>
                  ) : null}
                </ul>
              )}
            </Section>

            <Section index={7} title={t("dna.command.live")}>
              {tasks.length === 0 && !(activity && activity.data.length) ? (
                <p className="text-sm text-muted-foreground">{t("command.activityEmpty")}</p>
              ) : (
                <ol className="relative grid gap-3 border-s ps-4">
                  {tasks.map((tk) => (
                    <li key={tk.id} className="relative">
                      <span aria-hidden className="absolute -start-[1.4rem] top-1">
                        <AiAvatar seed={tk.profile} department={tk.profile} size={18} />
                      </span>
                      <Link href={`/${locale}/tasks/${tk.id}`} className="block truncate text-sm hover:underline">
                        {tk.title}
                      </Link>
                      <span className="flex items-center gap-2 text-xs text-muted-foreground">
                        <StatusDot tone={statusTone(tk.status)} />
                        {t(`agentTasks.status.${tk.status}`)}
                        <time dateTime={tk.updatedAt.toISOString()}>· {formatRelativeTime(tk.updatedAt, locale)}</time>
                      </span>
                    </li>
                  ))}
                  {(activity?.data ?? []).slice(0, Math.max(0, 8 - tasks.length)).map((a) => (
                    <li key={a.id} className="relative">
                      <span aria-hidden className="absolute -start-[1.3rem] top-1.5 size-2 rounded-full bg-border-strong" />
                      <span className="block truncate font-mono text-xs">{a.action}</span>
                      <span className="text-xs text-muted-foreground">
                        {a.resourceType} · <time dateTime={a.createdAt.toISOString()}>{formatRelativeTime(a.createdAt, locale)}</time>
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </Section>
          </div>
        ) : null}

        {/* Your day, setup and profile */}
        <div className="grid gap-8 lg:grid-cols-3">
          {company ? (
            <Section index={8} title={t("command.today.title")} description={formatDate(new Date(), locale, tz, { dateStyle: "full" })}>
              <div className="grid gap-4 text-sm">
                {today?.tasks === null && today?.meetings === null && today?.followUps === null ? <p className="text-muted-foreground">{t("command.today.forbidden")}</p> : null}
                {today?.tasks ? (
                  <section className="grid gap-1.5">
                    <h3 className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                      <ListTodo className="size-4" aria-hidden />
                      {t("command.today.tasks")}
                    </h3>
                    {today.tasks.length === 0 ? (
                      <p className="text-muted-foreground">{t("command.today.noTasks")}</p>
                    ) : (
                      <ul className="grid gap-1">
                        {today.tasks.map((tk) => (
                          <li key={tk.id} className="flex items-center gap-2">
                            <Link href={`/${locale}/projects/tasks/${tk.id}`} className="min-w-0 flex-1 truncate hover:underline">
                              {tk.title}
                            </Link>
                            {tk.dueDate && tk.dueDate < today.todayDate ? <Badge tone="danger">{t("command.today.overdue")}</Badge> : null}
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                ) : null}
                {today?.meetings ? (
                  <section className="grid gap-1.5">
                    <h3 className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                      <CalendarClock className="size-4" aria-hidden />
                      {t("command.today.meetings")}
                    </h3>
                    {today.meetings.length === 0 ? (
                      <p className="text-muted-foreground">{t("command.today.noMeetings")}</p>
                    ) : (
                      <ul className="grid gap-1">
                        {today.meetings.map((m) => (
                          <li key={m.id} className="flex items-center gap-2">
                            <span className="tabular w-24 shrink-0 text-xs text-muted-foreground">
                              {time(m.startsAt)}–{time(m.endsAt)}
                            </span>
                            <Link href={`/${locale}/communication/meetings/${m.id}`} className="min-w-0 flex-1 truncate hover:underline">
                              {m.title}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                ) : null}
                {today?.followUps ? (
                  <section className="grid gap-1.5">
                    <h3 className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                      <PhoneCall className="size-4" aria-hidden />
                      {t("command.today.followUps")}
                    </h3>
                    {today.followUps.length === 0 ? (
                      <p className="text-muted-foreground">{t("command.today.noFollowUps")}</p>
                    ) : (
                      <ul className="grid gap-1">
                        {today.followUps.map((f) => (
                          <li key={f.id} className="flex items-center gap-2">
                            <Link href={`/${locale}${f.href}`} className="min-w-0 flex-1 truncate hover:underline">
                              {f.label ? `${f.label}: ` : ""}
                              {f.note}
                            </Link>
                            {f.dueAt < today.todayStart ? <Badge tone="danger">{t("command.today.overdue")}</Badge> : <span className="tabular text-xs text-muted-foreground">{time(f.dueAt)}</span>}
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                ) : null}
              </div>
            </Section>
          ) : null}

          <Section index={9} title={t("command.setup")} description={t("dna.command.setupProgress", { done: setupDone, total: setup.length })}>
            <div className="grid gap-3">
              <ProgressBar value={setupDone / setup.length} label={t("command.setup")} />
              <ul className="grid gap-1">
                {setup.map((s) => (
                  <li key={s.key}>
                    <Link href={`/${locale}${s.href}`} className="flex items-center gap-2 rounded-md px-1 py-1.5 text-sm hover:bg-muted">
                      {s.done ? <CheckCircle2 className="size-4 text-success" aria-hidden /> : <Circle className="size-4 text-muted-foreground" aria-hidden />}
                      <span className={s.done ? "text-muted-foreground line-through" : undefined}>{t(`command.setupItems.${s.key}`)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </Section>

          <Section index={10} title={t("command.companyProfile")}>
            {company ? (
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                <dt className="text-muted-foreground">{t("command.incorporation")}</dt>
                <dd>{country(company.incorporationCountryCode)}</dd>
                <dt className="text-muted-foreground">{t("command.operating")}</dt>
                <dd>{company.operatingCountryCodes.length ? formatList(company.operatingCountryCodes.map(country), locale) : t("command.notSet")}</dd>
                <dt className="text-muted-foreground">{t("command.targets")}</dt>
                <dd>{company.targetMarketCodes.length ? formatList(company.targetMarketCodes.map(country), locale) : t("command.notSet")}</dd>
                <dt className="text-muted-foreground">{t("command.baseCurrency")}</dt>
                <dd>
                  {displayName(company.baseCurrency, "currency", locale)} <span className="font-mono text-xs text-muted-foreground">{company.baseCurrency}</span>
                </dd>
                <dt className="text-muted-foreground">{t("command.localTime")}</dt>
                <dd>
                  <LiveClock timeZone={company.timezone} /> <span className="font-mono text-xs text-muted-foreground">{company.timezone}</span>
                </dd>
                <dt className="text-muted-foreground">{t("command.dataRegion")}</dt>
                <dd>{t(`onboarding.dataRegions.${company.dataRegion}`)}</dd>
              </dl>
            ) : (
              <div className="grid justify-items-start gap-3">
                <p className="text-muted-foreground">{t("command.noCompany")}</p>
                <Button asChild size="sm">
                  <Link href={`/${locale}/company`}>{t("command.createCompany")}</Link>
                </Button>
              </div>
            )}
          </Section>
        </div>
      </div>
    </World>
  );
}
