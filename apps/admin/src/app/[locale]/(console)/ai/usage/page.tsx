import Link from "next/link";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { CircleDollarSign, Coins, Cpu, Database, LineChart } from "lucide-react";
import { CountUp } from "@/components/motion/count-up";
import { AdminHeader, EmptyState, StatGrid, StatTile, guard, sp, usd } from "@/components/admin/kit";
import { AdminBreadcrumbs } from "@/components/admin/nav/breadcrumbs";
import { Timestamp } from "@/components/admin/timestamp";
import { BarList, TrendChart } from "@/components/admin/viz";
import { getLocale, getT } from "@/i18n/server";
import { formatNumber } from "@/i18n/format";
import { aiCostUsage } from "@/server/modules/admin/ai";
import { requireViewer } from "@/server/session";

const RANGES = [7, 30, 90] as const;

/** AI cost and usage from the cost ledger: by organization, model, provider, operation, department and day. */
export default async function AdminAiUsagePage({ searchParams }: PageProps<"/[locale]/ai/usage">) {
  const locale = await getLocale();
  const t = await getT(locale);
  const viewer = await requireViewer(locale);
  const wanted = sp((await searchParams).days);
  const days = RANGES.find((d) => String(d) === wanted) ?? 30;
  const r = await guard(aiCostUsage(viewer.ctx, { days }), t("errors.forbidden"));
  if (!r.ok) return r.node;
  const u = r.value;
  const totals = u.byProvider.reduce((a, m) => ({ tokens: a.tokens + m.tokens, cached: a.cached + m.cachedTokens, costMicros: a.costMicros + m.costMicros, calls: a.calls + m.calls }), { tokens: 0, cached: 0, costMicros: 0, calls: 0 });
  const n = (v: number) => formatNumber(v, locale);
  const base = `/${locale}/ai/usage`;
  // Day axis (UTC), oldest first, filled with zeros where the ledger has no rows.
  const axis = Array.from({ length: days }, (_, i) => new Date(Date.parse(u.computedAt) - (days - 1 - i) * 86_400_000).toISOString().slice(0, 10));
  const byDay = new Map(u.byDay.map((d) => [d.day, d]));
  const table = (rows: { key: string; label: ReactNode; tokens: number; costMicros: number; calls: number }[]) =>
    rows.length === 0 ? (
      <EmptyState icon={<Coins />} title={t("admin.ai.noUsage")} body={t("admin.ai.noUsageHint")} />
    ) : (
      <Table>
        <THead>
          <Tr>
            <Th>{t("admin.ai.columns.name")}</Th>
            <Th>{t("admin.aiRequests.callsHeader")}</Th>
            <Th>{t("admin.ai.columns.tokens")}</Th>
            <Th>{t("admin.ai.columns.cost")}</Th>
          </Tr>
        </THead>
        <TBody>
          {rows.map((row) => (
            <Tr key={row.key}>
              <Td className="max-w-64 truncate">{row.label}</Td>
              <Td className="tabular">{n(row.calls)}</Td>
              <Td className="tabular">{n(row.tokens)}</Td>
              <Td className="tabular">{usd(row.costMicros, locale)}</Td>
            </Tr>
          ))}
        </TBody>
      </Table>
    );
  const bars = (items: { key: string; label: ReactNode; costMicros: number; tokens: number; href?: string }[], label: string) => (
    <BarList label={label} tone="warning" items={items.slice(0, 10).map((x) => ({ key: x.key, label: x.label, value: x.costMicros, display: `${usd(x.costMicros, locale)} · ${n(x.tokens)}`, href: x.href }))} empty={<EmptyState icon={<Coins />} title={t("admin.ai.noUsage")} />} />
  );
  return (
    <div className="grid gap-4">
      <AdminBreadcrumbs />
      <AdminHeader
        icon={<LineChart />}
        title={t("admin.nav.aiUsage")}
        description={t("admin.ai.usageSubtitle")}
        why={t("admin.ai.usageWhy")}
        actions={RANGES.map((d) => (
          <Button key={d} asChild size="sm" variant={d === days ? "secondary" : "ghost"}>
            <Link href={`${base}?days=${d}`}>{t("admin.common.lastDays", { count: d })}</Link>
          </Button>
        ))}
        meta={
          <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
            <Database className="size-3" aria-hidden />
            {t("admin.ai.usageSource")} · <Timestamp value={u.computedAt} mode="relative" />
          </span>
        }
      />
      <StatGrid>
        <StatTile icon={<CircleDollarSign />} label={t("admin.ai.columns.cost")} value={usd(totals.costMicros, locale)} hint={t("admin.common.lastDays", { count: days })} href={`/${locale}/ai/budgets`} />
        <StatTile icon={<Coins />} label={t("admin.ai.columns.tokens")} value={<CountUp value={totals.tokens} format="compact" />} hint={t("admin.aiRequests.cached", { count: totals.cached })} />
        <StatTile icon={<Cpu />} label={t("admin.aiRequests.callsHeader")} value={<CountUp value={totals.calls} />} hint={t("admin.common.lastDays", { count: days })} href={`/${locale}/ai/requests`} />
        <StatTile icon={<Coins />} label={t("admin.ai.costPerCall")} value={totals.calls ? usd(Math.round(totals.costMicros / totals.calls), locale) : t("admin.aiRequests.noData")} />
      </StatGrid>
      <Card>
        <CardHeader title={t("admin.ai.byDay")} description={t("admin.ai.byDayHint")} />
        <CardBody className="grid gap-6">
          <TrendChart title={t("admin.ai.seriesCost")} days={axis} series={[{ label: t("admin.ai.seriesCost"), values: axis.map((d) => byDay.get(d)?.costMicros ?? 0), tone: "warning", format: "usdMicros" }]} />
          <TrendChart title={t("admin.ai.seriesTokens")} days={axis} height={130} series={[{ label: t("admin.ai.seriesTokens"), values: axis.map((d) => byDay.get(d)?.tokens ?? 0), tone: "primary", format: "compact" }]} />
        </CardBody>
      </Card>
      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title={t("admin.ai.byOrg")} />
          <CardBody>{bars(u.byOrg.map((o) => ({ key: o.id, label: o.name, costMicros: o.costMicros, tokens: o.tokens, href: `/${locale}/organizations/${o.id}` })), t("admin.ai.byOrg"))}</CardBody>
          {u.byOrg.length ? table(u.byOrg.map((o) => ({ key: o.id, label: <Link href={`/${locale}/organizations/${o.id}`} className="hover:underline">{o.name}</Link>, ...o }))) : null}
        </Card>
        <Card>
          <CardHeader title={t("admin.ai.byModel")} />
          <CardBody>{bars(u.byModel.map((m) => ({ key: m.model, label: <span className="font-mono text-xs">{m.model}</span>, costMicros: m.costMicros, tokens: m.tokens, href: `/${locale}/ai/requests?model=${encodeURIComponent(m.model)}&window=30d` })), t("admin.ai.byModel"))}</CardBody>
          {u.byModel.length ? table(u.byModel.map((m) => ({ key: m.model, label: <span className="font-mono text-xs">{m.model}</span>, ...m }))) : null}
        </Card>
        <Card>
          <CardHeader title={t("admin.ai.byProvider")} />
          {table(u.byProvider.map((p) => ({ key: p.provider, label: <Link href={`/${locale}/ai/providers/${p.provider}`} className="hover:underline">{p.provider}</Link>, ...p })))}
        </Card>
        <Card>
          <CardHeader title={t("admin.ai.byOperation")} description={t("admin.ai.byOperationHint")} />
          {table(u.byOperation.map((p) => ({ key: p.operation, label: <span className="font-mono text-xs">{p.operation}</span>, ...p })))}
        </Card>
        <Card className="xl:col-span-2">
          <CardHeader title={t("admin.ai.byDepartment")} />
          {table(u.byDepartment.map((p) => ({ key: p.department, label: p.department, ...p })))}
        </Card>
      </div>
    </div>
  );
}
