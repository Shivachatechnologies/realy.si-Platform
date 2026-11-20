import Link from "next/link";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { CircleDollarSign, Coins, Cpu, LineChart } from "lucide-react";
import { CardBody } from "@/components/ui/card";
import { CountUp } from "@/components/motion/count-up";
import { AdminHeader, EmptyState, StatGrid, StatTile, guard, sp, usd } from "@/components/admin/kit";
import { BarList, TrendChart } from "@/components/admin/viz";
import { getLocale, getT } from "@/i18n/server";
import { formatNumber } from "@/i18n/format";
import { aiCostUsage } from "@/server/modules/admin/ai";
import { aiDailySeries } from "@/server/modules/admin/trends";
import { requireViewer } from "@/server/session";

const RANGES = [7, 30, 90] as const;

/** AI cost and usage by organization, model and day (estimated with workforce/pricing.ts list prices). */
export default async function AdminAiUsagePage({ searchParams }: PageProps<"/[locale]/admin/ai/usage">) {
  const locale = await getLocale();
  const t = await getT(locale);
  const viewer = await requireViewer(locale);
  const wanted = sp((await searchParams).days);
  const days = RANGES.find((d) => String(d) === wanted) ?? 30;
  const r = await guard(Promise.all([aiCostUsage(viewer.ctx, { days }), aiDailySeries(viewer.ctx, days)]), t("errors.forbidden"));
  if (!r.ok) return r.node;
  const [u, series] = r.value;
  const totals = u.byModel.reduce((a, m) => ({ tokens: a.tokens + m.tokens, costMicros: a.costMicros + m.costMicros, tasks: a.tasks + m.tasks }), { tokens: 0, costMicros: 0, tasks: 0 });
  const n = (v: number) => formatNumber(v, locale);
  const base = `/${locale}/admin/ai/usage`;
  const table = (rows: { key: string; label: ReactNode; tokens: number; costMicros: number; tasks: number }[]) =>
    rows.length === 0 ? (
      <EmptyState icon={<Coins />} title={t("admin.ai.noUsage")} body={t("admin.ai.noUsageHint")} />
    ) : (
      <Table>
        <THead>
          <Tr>
            <Th>{t("admin.ai.columns.name")}</Th>
            <Th>{t("admin.ai.columns.tasks")}</Th>
            <Th>{t("admin.ai.columns.tokens")}</Th>
            <Th>{t("admin.ai.columns.cost")}</Th>
          </Tr>
        </THead>
        <TBody>
          {rows.map((row) => (
            <Tr key={row.key}>
              <Td className="max-w-64 truncate">{row.label}</Td>
              <Td className="tabular">{n(row.tasks)}</Td>
              <Td className="tabular">{n(row.tokens)}</Td>
              <Td className="tabular">{usd(row.costMicros, locale)}</Td>
            </Tr>
          ))}
        </TBody>
      </Table>
    );
  return (
    <div className="grid gap-4">
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
      />
      <StatGrid className="xl:grid-cols-3">
        <StatTile icon={<CircleDollarSign />} label={t("admin.ai.columns.cost")} value={usd(totals.costMicros, locale)} hint={t("admin.common.lastDays", { count: days })} />
        <StatTile icon={<Coins />} label={t("admin.ai.columns.tokens")} value={<CountUp value={totals.tokens} format="compact" />} hint={t("admin.common.lastDays", { count: days })} />
        <StatTile icon={<Cpu />} label={t("admin.ai.columns.tasks")} value={<CountUp value={totals.tasks} />} hint={t("admin.common.lastDays", { count: days })} />
      </StatGrid>
      <Card>
        <CardHeader title={t("admin.ai.byDay")} description={t("admin.ai.byDayHint")} />
        <CardBody className="grid gap-6">
          <TrendChart title={t("admin.ai.seriesCost")} days={series.days} series={[{ label: t("admin.ai.seriesCost"), values: series.costMicros, tone: "warning", format: "usdMicros" }]} />
          <TrendChart
            title={t("admin.ai.seriesTokens")}
            days={series.days}
            height={130}
            series={[
              { label: t("admin.ai.seriesTokens"), values: series.tokens, tone: "primary", format: "compact" },
            ]}
          />
        </CardBody>
      </Card>
      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title={t("admin.ai.byOrg")} />
          <CardBody>
            <BarList
              label={t("admin.ai.byOrg")}
              tone="warning"
              items={u.byOrg.slice(0, 10).map((o) => ({ key: o.id, label: o.name, value: o.costMicros, display: `${usd(o.costMicros, locale)} · ${n(o.tokens)}`, href: `/${locale}/admin/organizations/${o.id}` }))}
              empty={<EmptyState icon={<Coins />} title={t("admin.ai.noUsage")} />}
            />
          </CardBody>
          {u.byOrg.length ? table(u.byOrg.map((o) => ({ key: o.id, label: <Link href={`/${locale}/admin/organizations/${o.id}`} className="hover:underline">{o.name}</Link>, ...o }))) : null}
        </Card>
        <Card>
          <CardHeader title={t("admin.ai.byModel")} />
          <CardBody>
            <BarList
              label={t("admin.ai.byModel")}
              items={u.byModel.map((m) => ({ key: m.model, label: <span className="font-mono text-xs">{m.model}</span>, value: m.costMicros, display: `${usd(m.costMicros, locale)} · ${n(m.tokens)}` }))}
              empty={<EmptyState icon={<Coins />} title={t("admin.ai.noUsage")} />}
            />
          </CardBody>
          {u.byModel.length ? table(u.byModel.map((m) => ({ key: m.model, label: <span className="font-mono text-xs">{m.model}</span>, ...m }))) : null}
        </Card>
      </div>
    </div>
  );
}
