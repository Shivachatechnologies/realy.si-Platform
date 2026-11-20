import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Play } from "lucide-react";
import { AutoRefresh } from "@/components/agents/auto-refresh";
import { TaskStatusBadge } from "@/components/agents/status-badge";
import { formatChange, formatMetric } from "@/components/bi/format";
import { ActionButton } from "@/components/workforce/action-button";
import { AiAvatar } from "@/components/workforce/avatar";
import { GrowthSettingsForm } from "@/components/workforce/growth-settings-form";
import { IntelligenceTabs } from "@/components/workforce/intelligence-tabs";
import { HeaderStrip } from "@/components/workforce/header-strip";
import { HelpMeButton } from "@/components/workforce/help-me-button";
import { PageHeader } from "@/components/workforce/page-header";
import { PageState, Pager, qs } from "@/components/workforce/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { Select } from "@/components/ui/input";
import { getLocale, getT } from "@/i18n/server";
import type { Translate } from "@/i18n/translate";
import { formatDateTime, formatNumber, formatRelativeTime } from "@/i18n/format";
import { db } from "@/server/core/db";
import { can } from "@/server/modules/rbac/service";
import { companyChain } from "@/server/modules/rbac/scope";
import { getSettings, insightFilters, listInsights } from "@/server/modules/growth/service";
import { GROWTH_SIGNALS, RESPONSIBLE } from "@/server/modules/growth/signals";
import { loopStages } from "@/server/modules/growth/stages";
import { requireOrgContext } from "@/server/workspace";
import { cn } from "@/lib/utils";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("growth.title") };
}

const SEVERITY_TONE = { INFO: "info", WARNING: "warning", CRITICAL: "danger" } as const;
const STATUS_TONE = { OPEN: "warning", ACTED: "success", DISMISSED: "neutral" } as const;

/** Evidence numbers, formatted by their key (…Minor = money, …Pct / …Rate = percent). */
function Evidence({ evidence, t, locale }: { evidence: Record<string, unknown>; t: Translate; locale: string }) {
  const currency = typeof evidence.currency === "string" ? evidence.currency : "USD";
  const entries = Object.entries(evidence).filter(([k]) => k !== "currency");
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-3">
      {entries.map(([k, v]) => {
        const n = typeof v === "number" ? v : null;
        const shown = n === null ? "—" : /Minor$/.test(k) ? formatMetric(n, "money", locale, currency) : /Pct$/.test(k) ? (formatChange(n, locale) ?? "—") : /Rate$|Roi$/i.test(k) ? formatMetric(n, "percent", locale, currency) : formatNumber(n, locale);
        const label = t(`growth.evidence.${k}`);
        return (
          <div key={k} className="grid">
            <dt className="text-muted-foreground">{label === `growth.evidence.${k}` ? k : label}</dt>
            <dd className="tabular font-medium">{shown}</dd>
          </div>
        );
      })}
    </dl>
  );
}

/** Growth Engine: the loop's stage metrics, open insights with the AI work they triggered, settings and history. */
export default async function GrowthPage({ searchParams }: PageProps<"/[locale]/intelligence/growth">) {
  const locale = await getLocale();
  const t = await getT(locale);
  const { viewer, org, company } = await requireOrgContext(locale);
  const header = (
    <>
      <PageHeader title={t("growth.title")} subtitle={t("growth.subtitle")} />
      <IntelligenceTabs locale={locale} active="growth" labels={{ overview: t("intelligence.tabs.overview"), ceo: t("intelligence.tabs.ceo"), growth: t("intelligence.tabs.growth") }} />
    </>
  );
  if (!company) return <PageState header={header} kind="empty" message={t("company.empty")} />;
  const chain = await companyChain(db(), org.id, company.id);
  const [canRead, canAnalytics, canManage] = await Promise.all([can(viewer.ctx, "agents.read", chain), can(viewer.ctx, "analytics.read", chain), can(viewer.ctx, "agents.manage", chain)]);
  if (!canRead || !canAnalytics) return <PageState header={header} kind="forbidden" message={t("errors.forbidden")} />;
  const sp = Object.fromEntries(Object.entries(await searchParams).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v])) as Record<string, string | undefined>;
  const f = insightFilters.parse(sp);
  const scope = { organizationId: org.id, companyId: company.id };
  const [settings, loop, open, history, ceo] = await Promise.all([
    getSettings(viewer.ctx, org.id, company.id),
    loopStages(viewer.ctx, org.id, company.id),
    listInsights(viewer.ctx, org.id, company.id, { status: "OPEN", limit: 20 }),
    listInsights(viewer.ctx, org.id, company.id, { ...f, cursor: sp.cursor, limit: 20 }),
    db().aiEmployee.findFirst({ where: { ...scope, profileKey: "ai_ceo", archivedAt: null }, orderBy: { createdAt: "asc" }, select: { id: true, status: true } }),
  ]);
  const apiBase = `/api/v1/organizations/${org.id}/companies/${company.id}`;
  const tz = viewer.user.timezone;
  const working = open.data.some((i) => i.task && (i.task.status === "QUEUED" || i.task.status === "RUNNING"));
  const actedCount = history.data.filter((i) => i.status === "ACTED").length;

  return (
    <div className="mx-auto grid max-w-[1400px] gap-4">
      <AutoRefresh active={working} intervalMs={6000} />
      {header}
      {!ceo || ceo.status !== "ACTIVE" ? (
        <Notice
          tone="warning"
          action={
            canManage && !ceo ? (
              <Button asChild size="sm">
                <Link href={`/${locale}/workforce/hire?profile=ai_ceo`}>{t("intelligence.hireCeo")}</Link>
              </Button>
            ) : null
          }
        >
          {t("growth.needsCeo")}
        </Notice>
      ) : null}

      <HeaderStrip
        t={t}
        what={t("growth.strip.what")}
        why={t("growth.strip.why")}
        can={t("growth.strip.can")}
        next={open.data.length ? t("growth.strip.nextAct") : t("growth.strip.nextRun")}
        action={
          canManage ? (
            <ActionButton path={`${apiBase}/growth/run`} variant="default">
              <Play aria-hidden />
              {t("growth.runNow")}
            </ActionButton>
          ) : null
        }
      />
      <Card variant="elevated">
        <CardHeader title={t("growth.loop.title")} description={t("growth.loop.hint")} />
        <CardBody>
          <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {loop.stages.map((s, i) => (
              <li key={s.stage} className={cn("relative grid content-start gap-2 rounded-md border p-3", s.openInsights ? "border-warning/50 bg-warning/5" : undefined)}>
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold">
                    <span className="me-1 text-xs text-muted-foreground">{i + 1}.</span>
                    {t(`growth.stages.${s.stage}`)}
                  </h3>
                  {s.openInsights ? <Badge tone="warning">{t("growth.openCount", { count: s.openInsights })}</Badge> : null}
                </div>
                {s.values.length === 0 ? (
                  <p className="text-xs text-muted-foreground">{t("growth.loop.noData")}</p>
                ) : (
                  <dl className="grid gap-1 text-xs">
                    {s.values.map((v) => (
                      <div key={v.key} className="flex items-baseline justify-between gap-2">
                        <dt className="truncate text-muted-foreground">{v.href ? <Link className="hover:underline" href={`/${locale}${v.href}`}>{t(v.labelKey)}</Link> : t(v.labelKey)}</dt>
                        <dd className="flex items-baseline gap-1 tabular">
                          <span className="font-medium">{formatMetric(v.value, v.unit, locale, loop.currency, { compact: true })}</span>
                          {v.changePct !== null ? <span className={cn("text-[10px]", v.trend === 1 ? "text-success" : v.trend === -1 ? "text-danger" : "text-muted-foreground")}>{formatChange(v.changePct, locale)}</span> : null}
                        </dd>
                      </div>
                    ))}
                  </dl>
                )}
                {i < loop.stages.length - 1 ? <ArrowRight aria-hidden className="absolute -end-3 top-1/2 hidden size-4 -translate-y-1/2 text-muted-foreground lg:block rtl:rotate-180" /> : null}
              </li>
            ))}
          </ol>
          <p className="mt-2 text-xs text-muted-foreground">{t("growth.loop.period")}</p>
        </CardBody>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title={t("growth.open.title")} description={t("growth.open.hint")} />
          {open.data.length === 0 ? (
            <CardBody className="grid justify-items-start gap-2 text-sm text-muted-foreground">
              <p>{t("growth.open.empty")}</p>
              {ceo?.status === "ACTIVE" ? (
                <HelpMeButton
                  apiBase={apiBase}
                  profile="ai_ceo"
                  aiEmployeeId={ceo.id}
                  label={t("growth.help")}
                  title={t("growth.helpTitle")}
                  instructions="Review the company's growth loop end to end (research, strategy, product, marketing, leads, sales, customers, revenue, analytics, optimisation) with read_company_kpis, read_growth_insights and the department read tools. Name the weakest stage with evidence and the three highest-impact actions for the next two weeks, each with an owner (AI employee or person). Delegate the first action to the right AI employee if one exists."
                />
              ) : null}
            </CardBody>
          ) : (
            <ul className="divide-y">
              {open.data.map((i) => (
                <li key={i.id} className="grid gap-2 px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={SEVERITY_TONE[i.severity]}>{t(`growth.severity.${i.severity}`)}</Badge>
                    <span className="font-medium">{t(`growth.signals.${i.signal}.title`)}</span>
                    <span className="text-xs text-muted-foreground">
                      {i.weekKey} · {formatRelativeTime(i.createdAt, locale)}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground">{t(`growth.signals.${i.signal}.description`)}</p>
                  <Evidence evidence={i.evidence as Record<string, unknown>} t={t} locale={locale} />
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="text-muted-foreground">{t("growth.responsible", { roles: RESPONSIBLE[i.signal].map((r) => t(`profiles.${r}.name`)).join(", ") })}</span>
                    {i.aiEmployee ? (
                      <Link className="flex items-center gap-1 hover:underline" href={`/${locale}/workforce/${i.aiEmployee.id}`}>
                        <AiAvatar id={i.aiEmployee.id} initials={i.aiEmployee.initials} size="sm" />
                        {i.aiEmployee.name}
                      </Link>
                    ) : null}
                    {i.task ? (
                      <span className="flex items-center gap-1">
                        <TaskStatusBadge status={i.task.status} label={t(`agentTasks.status.${i.task.status}`)} />
                        <Link className="text-primary hover:underline" href={`/${locale}/tasks/${i.task.id}`}>
                          {t("growth.viewWork")}
                        </Link>
                      </span>
                    ) : i.note ? (
                      <span className="text-muted-foreground">{t(`growth.notes.${i.note}`) === `growth.notes.${i.note}` ? t("growth.notes.other", { reason: i.note }) : t(`growth.notes.${i.note}`)}</span>
                    ) : null}
                  </div>
                  {canManage ? (
                    <div className="flex flex-wrap gap-2">
                      {!i.task || i.task.status === "FAILED" || i.task.status === "CANCELLED" ? (
                        <ActionButton path={`${apiBase}/growth/insights/${i.id}/act`} variant="default">
                          {t("growth.act")}
                        </ActionButton>
                      ) : null}
                      <ActionButton path={`${apiBase}/growth/insights/${i.id}`} method="PATCH" body={{ status: "ACTED" }}>
                        {t("growth.markActed")}
                      </ActionButton>
                      <ActionButton path={`${apiBase}/growth/insights/${i.id}`} method="PATCH" body={{ status: "DISMISSED" }} variant="ghost">
                        {t("growth.dismiss")}
                      </ActionButton>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader
            title={t("growth.settings.title")}
            description={settings.lastEvaluatedAt ? t("growth.settings.lastRun", { time: formatDateTime(settings.lastEvaluatedAt, locale, tz) }) : t("growth.settings.neverRun")}
            actions={
              canManage ? (
                <ActionButton path={`${apiBase}/growth/run`}>
                  <Play aria-hidden />
                  {t("growth.runNow")}
                </ActionButton>
              ) : null
            }
          />
          <CardBody className="grid gap-3">
            <GrowthSettingsForm apiBase={apiBase} initial={{ enabled: settings.enabled, autonomy: settings.autonomy, decisionThreshold: settings.decisionThreshold }} disabled={!canManage} />
            <p className="text-xs text-muted-foreground">{t("growth.settings.schedule")}</p>
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader
          title={t("growth.history.title")}
          description={t("growth.history.acted", { count: actedCount })}
          actions={
            <form method="get" className="flex flex-wrap items-center gap-2">
              <label className="sr-only" htmlFor="growth-status">
                {t("growth.history.status")}
              </label>
              <Select id="growth-status" name="status" defaultValue={f.status ?? ""} className="h-8 w-36">
                <option value="">{t("common.all")}</option>
                {(["OPEN", "ACTED", "DISMISSED"] as const).map((s) => (
                  <option key={s} value={s}>
                    {t(`growth.status.${s}`)}
                  </option>
                ))}
              </Select>
              <label className="sr-only" htmlFor="growth-signal">
                {t("growth.history.signal")}
              </label>
              <Select id="growth-signal" name="signal" defaultValue={f.signal ?? ""} className="h-8 w-48">
                <option value="">{t("common.all")}</option>
                {GROWTH_SIGNALS.map((s) => (
                  <option key={s} value={s}>
                    {t(`growth.signals.${s}.title`)}
                  </option>
                ))}
              </Select>
              <Button type="submit" size="sm" variant="secondary">
                {t("workforce.filters.apply")}
              </Button>
            </form>
          }
        />
        {history.data.length === 0 ? (
          <CardBody className="text-sm text-muted-foreground">{f.status || f.signal ? t("common.noResults") : t("growth.history.empty")}</CardBody>
        ) : (
          <ul className="divide-y text-sm">
            {history.data.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
                <span className="flex min-w-0 flex-wrap items-center gap-2">
                  <Badge tone={STATUS_TONE[i.status]}>{t(`growth.status.${i.status}`)}</Badge>
                  <span className="font-medium">{t(`growth.signals.${i.signal}.title`)}</span>
                  <span className="text-xs text-muted-foreground">
                    {i.weekKey} · {formatDateTime(i.createdAt, locale, tz)} · {t(`growth.autonomy.${i.autonomy}.name`)}
                  </span>
                </span>
                <span className="flex items-center gap-2 text-xs">
                  {i.aiEmployee ? <span>{i.aiEmployee.name}</span> : null}
                  {i.task ? (
                    <Link className="text-primary hover:underline" href={`/${locale}/tasks/${i.task.id}`}>
                      {t("growth.viewWork")}
                    </Link>
                  ) : null}
                  {canManage && i.status !== "OPEN" ? (
                    <ActionButton path={`${apiBase}/growth/insights/${i.id}`} method="PATCH" body={{ status: "OPEN" }} variant="ghost">
                      {t("growth.reopen")}
                    </ActionButton>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        )}
        <Pager
          prevHref={sp.cursor ? `/${locale}/intelligence/growth${qs({ status: f.status, signal: f.signal })}` : null}
          nextHref={history.nextCursor ? `/${locale}/intelligence/growth${qs({ status: f.status, signal: f.signal, cursor: history.nextCursor })}` : null}
          labels={{ previous: t("agentTasks.firstPage"), next: t("common.next") }}
        />
      </Card>
    </div>
  );
}
