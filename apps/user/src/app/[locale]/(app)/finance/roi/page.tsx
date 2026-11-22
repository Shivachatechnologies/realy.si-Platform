import type { Metadata } from "next";
import Link from "next/link";
import { Card, CardHeader } from "@/components/ui/card";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { financePage } from "@/components/finance/page-context";
import { usdCents } from "@/components/finance/ai-spend-card";
import { Empty, Kpi, RangeForm, rangePresets } from "@/components/finance/widgets";
import { getT } from "@/i18n/server";
import { parseRange } from "@/server/modules/finance/common";
import { roiAnalytics, type MoneyByCurrency } from "@/server/modules/finance/roi";
import { cn } from "@/lib/utils";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("finance.tabs.roi") };
}

/** ROI of AI spend (per AI employee and department) and of marketing campaigns, from recorded data only. */
export default async function RoiPage({ searchParams }: PageProps<"/[locale]/finance/roi">) {
  const p = await financePage("roi");
  if (p.blocked) return p.blocked;
  const { t, locale, viewer, org, company, money } = p;
  const range = parseRange(await searchParams, 3);
  const r = await roiAnalytics(viewer.ctx, org.id, company.id, range);
  const usd = (micros: bigint) => money(usdCents(micros), "USD");
  const list = (xs: MoneyByCurrency[]) => (xs.length ? xs.map((x) => money(x.amountMinor, x.currency)).join(" + ") : "—");
  const roi = (v: number | null, mixed?: boolean) => (
    <span className={cn("tabular-nums", v !== null && v < 0 && "text-danger", v !== null && v > 0 && "text-success")} title={mixed ? t("finance.roi.mixed") : undefined}>
      {v === null ? (mixed ? t("finance.roi.mixedShort") : "—") : `${v}%`}
    </span>
  );
  const nothing = !r.byAgent.length && !r.byCampaign.length && !r.totals.dealsWon;

  return p.frame(
    <>
      <RangeForm action={`/${locale}/finance/roi`} from={range.fromStr} to={range.toStr} labels={{ from: t("finance.range.from"), to: t("finance.range.to"), apply: t("finance.range.apply"), presets: rangePresets(t) }} />
      <p className="text-sm text-muted-foreground">{t("finance.roi.method")}</p>
      <div className="grid gap-3 sm:grid-cols-4">
        <Kpi label={t("finance.roi.aiCost")} value={usd(r.totals.aiCostMicros)} hint={t("finance.aiSpend.estimated", { amount: usd(r.totals.aiEstimatedMicros) })} />
        <Kpi label={t("finance.roi.dealsWon")} value={r.totals.dealsWon} />
        <Kpi label={t("finance.roi.revenueWon")} value={list(r.totals.revenue)} />
        <Kpi label={t("finance.roi.unattributed")} value={r.totals.unattributedDeals} />
      </div>
      {nothing ? (
        <Card>
          <Empty>{t("finance.roi.empty")}</Empty>
        </Card>
      ) : null}
      <Card>
        <CardHeader title={t("finance.roi.agentsTitle")} description={t("finance.roi.agentsHint")} />
        {r.byAgent.length ? (
          <Table>
            <THead>
              <Tr>
                <Th>{t("finance.roi.agent")}</Th>
                <Th>{t("finance.roi.department")}</Th>
                <Th className="text-end">{t("finance.roi.cost")}</Th>
                <Th className="text-end">{t("finance.roi.tasks")}</Th>
                <Th className="text-end">{t("finance.roi.dealsWon")}</Th>
                <Th className="text-end">{t("finance.roi.revenue")}</Th>
                <Th className="text-end">{t("finance.roi.roi")}</Th>
              </Tr>
            </THead>
            <TBody>
              {r.byAgent.map((a) => (
                <Tr key={a.id}>
                  <Td>
                    <Link href={`/${locale}/workforce/${a.id}`} className="font-medium hover:underline">
                      {a.name ?? a.id.slice(0, 8)}
                    </Link>
                  </Td>
                  <Td>{a.department ?? "—"}</Td>
                  <Td className="text-end tabular-nums">{usd(a.costMicros)}</Td>
                  <Td className="text-end tabular-nums">{a.tasksCompleted}</Td>
                  <Td className="text-end tabular-nums">{a.dealsWon}</Td>
                  <Td className="text-end tabular-nums">{list(a.revenue)}</Td>
                  <Td className="text-end">{roi(a.roiPct, a.mixedCurrencies)}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        ) : (
          <Empty>{t("finance.roi.noAgents")}</Empty>
        )}
      </Card>
      <Card>
        <CardHeader title={t("finance.roi.departmentsTitle")} description={t("finance.roi.departmentsHint")} />
        {r.byDepartment.length ? (
          <Table>
            <THead>
              <Tr>
                <Th>{t("finance.roi.department")}</Th>
                <Th className="text-end">{t("finance.roi.cost")}</Th>
                <Th className="text-end">{t("finance.roi.dealsWon")}</Th>
                <Th className="text-end">{t("finance.roi.revenue")}</Th>
                <Th className="text-end">{t("finance.roi.roi")}</Th>
              </Tr>
            </THead>
            <TBody>
              {r.byDepartment.map((d) => (
                <Tr key={d.key}>
                  <Td className="font-medium">{d.key}</Td>
                  <Td className="text-end tabular-nums">{usd(d.costMicros)}</Td>
                  <Td className="text-end tabular-nums">{d.dealsWon}</Td>
                  <Td className="text-end tabular-nums">{list(d.revenue)}</Td>
                  <Td className="text-end">{roi(d.roiPct, d.mixedCurrencies)}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        ) : (
          <Empty>{t("finance.roi.noDepartments")}</Empty>
        )}
      </Card>
      <Card>
        <CardHeader title={t("finance.roi.campaignsTitle")} description={t("finance.roi.campaignsHint")} />
        {r.byCampaign.length ? (
          <Table>
            <THead>
              <Tr>
                <Th>{t("finance.roi.campaign")}</Th>
                <Th className="text-end">{t("finance.roi.budget")}</Th>
                <Th className="text-end">{t("finance.roi.spend")}</Th>
                <Th className="text-end">{t("finance.roi.dealsWon")}</Th>
                <Th className="text-end">{t("finance.roi.revenue")}</Th>
                <Th className="text-end">{t("finance.roi.roi")}</Th>
              </Tr>
            </THead>
            <TBody>
              {r.byCampaign.map((c) => (
                <Tr key={c.id}>
                  <Td>
                    <Link href={`/${locale}/marketing/campaigns/${c.id}`} className="font-medium hover:underline">
                      {c.name}
                    </Link>
                    <span className="block font-mono text-xs text-muted-foreground">{c.code}</span>
                  </Td>
                  <Td className="text-end tabular-nums">{money(c.budgetMinor, c.currency)}</Td>
                  <Td className="text-end tabular-nums">{list(c.spend)}</Td>
                  <Td className="text-end tabular-nums">{c.dealsWon}</Td>
                  <Td className="text-end tabular-nums">{list(c.revenue)}</Td>
                  <Td className="text-end">{roi(c.roiPct, c.mixedCurrencies)}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        ) : (
          <Empty>{t("finance.roi.noCampaigns")}</Empty>
        )}
      </Card>
      {r.totals.truncated ? <p className="text-xs text-muted-foreground">{t("finance.roi.truncated")}</p> : null}
      <p className="text-xs text-muted-foreground">{company.baseCurrency !== r.aiCurrency ? t("finance.aiSpend.notConverted") : null}</p>
    </>,
  );
}
