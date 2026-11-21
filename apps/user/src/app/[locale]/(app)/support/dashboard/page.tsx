import type { Metadata } from "next";
import { PageIntro } from "@/components/guide-kit/page-intro";
import { introLabels } from "@/components/guide-kit/server";
import Link from "next/link";
import { Card, CardHeader } from "@/components/ui/card";
import { Stat } from "@/components/comms/bits";
import { areaPage } from "@/components/comms/context";
import { PriorityBadge } from "@/components/support/bits";
import { getT } from "@/i18n/server";
import { formatNumber } from "@/i18n/format";
import { db } from "@/server/core/db";
import { OPEN_STATUSES, userNames } from "@/server/modules/support/common";
import { SUPPORT_METRICS } from "@/server/modules/support/metrics";
import { supportAnalytics } from "@/server/modules/support/analytics";
import { CsatPanel, SpeedByPriority, VolumeChart } from "@/components/support/analytics-charts";
import { cn } from "@/lib/utils";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("support.dashboard.title") };
}

const DAY = 86_400_000;

export default async function SupportDashboardPage({ searchParams }: PageProps<"/[locale]/support/dashboard">) {
  const p = await areaPage("support", "dashboard");
  if (p.gate) return p.gate;
  const { locale, t, viewer, org, company, wrap } = p;
  const sp = await searchParams;
  const days = [7, 30, 90].includes(Number(sp.days)) ? Number(sp.days) : 30;
  const to = new Date();
  const from = new Date(to.getTime() - days * DAY);
  const prevFrom = new Date(from.getTime() - days * DAY);
  const scope = { organizationId: org.id, companyId: company.id, currency: company.baseCurrency };
  const values = await Promise.all(SUPPORT_METRICS.map(async (m) => ({ m, now: Number(await m.compute(scope, { from, to })), before: Number(await m.compute(scope, { from: prevFrom, to: from })) })));
  const openWhere = { organizationId: org.id, companyId: company.id, status: { in: [...OPEN_STATUSES] } };
  const [byPriority, byCategory, byAssignee, byChannel, categories] = await Promise.all([
    db().supportTicket.groupBy({ by: ["priority"], where: openWhere, _count: { _all: true } }),
    db().supportTicket.groupBy({ by: ["categoryId"], where: { organizationId: org.id, companyId: company.id, createdAt: { gte: from } }, _count: { _all: true } }),
    db().supportTicket.groupBy({ by: ["assigneeId"], where: openWhere, _count: { _all: true } }),
    db().supportTicket.groupBy({ by: ["channel"], where: { organizationId: org.id, companyId: company.id, createdAt: { gte: from } }, _count: { _all: true } }),
    db().supportCategory.findMany({ where: { companyId: company.id }, select: { id: true, name: true } }),
  ]);
  const names = await userNames(db(), byAssignee.map((a) => a.assigneeId));
  const analytics = await supportAnalytics(viewer.ctx, org.id, company.id, days);
  const pctOrDash = (v: number | null) => (v == null ? "—" : `${formatNumber(v, locale, { maximumFractionDigits: 1 })}%`);
  const hoursOrDash = (v: number | null) => (v == null ? "—" : t("support.dashboard.hours", { value: formatNumber(v, locale, { maximumFractionDigits: 1 }) }));
  const catName = new Map(categories.map((c) => [c.id, c.name]));
  const fmt = (unit: string, v: number) => (unit === "percent" ? `${formatNumber(v, locale, { maximumFractionDigits: 1 })}%` : unit === "hours" ? t("support.dashboard.hours", { value: formatNumber(v, locale, { maximumFractionDigits: 1 }) }) : formatNumber(v, locale));
  const bar = (rows: { label: React.ReactNode; count: number; key: string }[]) => {
    const max = Math.max(1, ...rows.map((r) => r.count));
    return rows.length ? (
      <ul className="grid gap-1.5 p-4">
        {rows.map((r) => (
          <li key={r.key} className="grid grid-cols-[9rem_minmax(0,1fr)_2.5rem] items-center gap-2 text-sm">
            <span className="truncate">{r.label}</span>
            <span className="h-2 rounded-full bg-muted">
              <span className="block h-2 rounded-full bg-primary/60" style={{ width: `${(r.count / max) * 100}%` }} />
            </span>
            <span className="text-end tabular-nums">{r.count}</span>
          </li>
        ))}
      </ul>
    ) : (
      <p className="p-4 text-sm text-muted-foreground">{t("support.dashboard.noData")}</p>
    );
  };
  return wrap(
    <>
    <PageIntro labels={introLabels(t)} what={t("support.intro.dashboard.what")} why={t("support.intro.dashboard.why")} can={t("support.intro.dashboard.can")} next={{ label: t("support.intro.dashboard.next"), href: `/${locale}/support` }} accent="warning" />
    <div className="grid gap-4">
      <div className="flex gap-1 text-sm">
        {[7, 30, 90].map((d) => (
          <Link key={d} href={`/${locale}/support/dashboard?days=${d}`} aria-current={d === days ? "page" : undefined} className={cn("rounded-md px-3 py-1", d === days ? "bg-muted font-medium" : "text-muted-foreground hover:bg-muted")}>
            {t("support.dashboard.lastDays", { count: d })}
          </Link>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {values.map(({ m, now, before }) => {
          const worse = m.higherIsBetter === false ? now > before : m.higherIsBetter ? now < before : false;
          return (
            <div key={m.key} className="grid gap-1">
              <Stat label={t(m.labelKey)} value={fmt(m.unit, now)} tone={worse && before ? "warning" : undefined} />
              {m.kind === "flow" ? <span className="px-1 text-[11px] text-muted-foreground">{t("support.dashboard.previous", { value: fmt(m.unit, before) })}</span> : null}
            </div>
          );
        })}
      </div>
      <Card variant="elevated">
        <CardHeader title={t("support.analytics.volumeTitle", { count: days })} description={t("support.analytics.volumeHint")} />
        <div className="p-4 pt-0">
          <VolumeChart t={t} locale={locale} data={analytics} />
        </div>
      </Card>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label={t("support.analytics.firstResponseMedian")} value={hoursOrDash(analytics.firstResponse.median)} />
        <Stat label={t("support.analytics.firstResponseP90")} value={hoursOrDash(analytics.firstResponse.p90)} />
        <Stat label={t("support.analytics.slaFirstResponse")} value={pctOrDash(analytics.sla.firstResponse)} />
        <Stat label={t("support.analytics.slaResolution")} value={pctOrDash(analytics.sla.resolution)} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title={t("support.analytics.csatTitle")} description={t("support.analytics.csatHint")} />
          <CsatPanel t={t} locale={locale} csat={analytics.csat} />
        </Card>
        <Card>
          <CardHeader title={t("support.analytics.speedTitle")} description={t("support.analytics.speedHint")} />
          <SpeedByPriority t={t} locale={locale} rows={analytics.byPriority} />
        </Card>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title={t("support.dashboard.openByPriority")} />
          {bar(["URGENT", "HIGH", "NORMAL", "LOW"].map((pr) => ({ key: pr, label: <PriorityBadge t={t} priority={pr as "LOW"} />, count: byPriority.find((x) => x.priority === pr)?._count._all ?? 0 })))}
        </Card>
        <Card>
          <CardHeader title={t("support.dashboard.agentLoad")} />
          {bar(byAssignee.sort((a, b) => b._count._all - a._count._all).map((a) => ({ key: a.assigneeId ?? "none", label: a.assigneeId ? (names.get(a.assigneeId) ?? "?") : t("support.ticket.unassigned"), count: a._count._all })))}
        </Card>
        <Card>
          <CardHeader title={t("support.dashboard.byCategory", { count: days })} />
          {bar(byCategory.sort((a, b) => b._count._all - a._count._all).map((c) => ({ key: c.categoryId ?? "none", label: c.categoryId ? (catName.get(c.categoryId) ?? "?") : t("support.ticket.noCategory"), count: c._count._all })))}
        </Card>
        <Card>
          <CardHeader title={t("support.dashboard.byChannel", { count: days })} />
          {bar(byChannel.map((c) => ({ key: c.channel, label: t(`support.channels.${c.channel}`), count: c._count._all })))}
        </Card>
      </div>
    </div>
    </>,
  );
}
