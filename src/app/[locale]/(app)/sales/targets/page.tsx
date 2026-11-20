import type { Metadata } from "next";
import Link from "next/link";
import { ActionButton } from "@/components/crm/kit";
import { TargetForm } from "@/components/crm/sales-forms";
import { CrmFrame, crmContext } from "@/components/crm/shell";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { getT } from "@/i18n/server";
import { formatDate, formatMoney, formatNumber } from "@/i18n/format";
import { isoDay } from "@/server/modules/crm/common";
import { periodStartOf } from "@/server/modules/crm/config";
import { targetAttainment } from "@/server/modules/crm/sales";
import { listOwners } from "@/server/modules/crm/service";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("sales.tabs.targets") };
}

export default async function TargetsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const c = await crmContext();
  const query = await searchParams;
  if (!c.company || !c.canRead) return <CrmFrame area="sales" active="targets">{null}</CrmFrame>;
  const { t, locale, base, org, company, viewer } = c;
  const period = query.period === "QUARTER" ? "QUARTER" : "MONTH";
  const atRaw = typeof query.at === "string" && /^\d{4}-\d{2}-\d{2}$/.test(query.at) ? new Date(`${query.at}T00:00:00Z`) : new Date();
  const start = periodStartOf(period, Number.isNaN(atRaw.getTime()) ? new Date() : atRaw);
  const step = period === "QUARTER" ? 3 : 1;
  const prev = isoDay(new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() - step, 1)));
  const next = isoDay(new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + step, 1)));
  const [att, owners] = await Promise.all([targetAttainment(viewer.ctx, org.id, company.id, period, start), listOwners(viewer.ctx, org.id, company.id)]);
  const pct = (v: number | null) => (v == null ? "—" : formatNumber(v, locale, { style: "percent", maximumFractionDigits: 0 }));
  const label =
    period === "QUARTER"
      ? t("sales.targets.quarterLabel", { q: Math.floor(start.getUTCMonth() / 3) + 1, year: start.getUTCFullYear() })
      : formatDate(start, locale, "UTC", { month: "long", year: "numeric" });
  const totals = att.rows.reduce((a, r) => ({ target: a.target + r.targetMinor, won: a.won + r.wonMinor }), { target: 0n, won: 0n });
  return (
    <CrmFrame area="sales" active="targets" subtitle={t("sales.targets.subtitle")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button asChild size="sm" variant="secondary">
            <Link href={`/${locale}/sales/targets?period=${period}&at=${prev}`}>←</Link>
          </Button>
          <h2 className="min-w-40 text-center font-semibold">{label}</h2>
          <Button asChild size="sm" variant="secondary">
            <Link href={`/${locale}/sales/targets?period=${period}&at=${next}`}>→</Link>
          </Button>
        </div>
        <nav className="flex gap-1 text-sm">
          {(["MONTH", "QUARTER"] as const).map((p) => (
            <Link key={p} href={`/${locale}/sales/targets?period=${p}&at=${isoDay(start)}`} aria-current={p === period ? "page" : undefined} className={p === period ? "rounded-md bg-muted px-3 py-1 font-medium" : "rounded-md px-3 py-1 text-muted-foreground hover:bg-muted"}>
              {t(`sales.targets.${p}`)}
            </Link>
          ))}
        </nav>
      </div>
      <Card>
        <CardHeader title={t("sales.targets.attainment")} description={att.rows.length ? t("sales.targets.teamTotal", { won: formatMoney({ amountMinor: totals.won, currency: company.baseCurrency }, locale), target: formatMoney({ amountMinor: totals.target, currency: company.baseCurrency }, locale) }) : undefined} />
        {att.rows.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr className="border-b">
                  <th className="p-2 text-start font-medium">{t("crm.owner")}</th>
                  <th className="p-2 text-end font-medium">{t("sales.targets.revenue")}</th>
                  <th className="p-2 text-end font-medium">{t("sales.kpi.wonRevenue")}</th>
                  <th className="p-2 text-start font-medium">{t("sales.targets.attainment")}</th>
                  <th className="p-2 text-end font-medium">{t("sales.targets.deals")}</th>
                  <th className="p-2" />
                </tr>
              </thead>
              <tbody className="divide-y">
                {att.rows.map((r) => (
                  <tr key={r.id}>
                    <td className="p-2 font-medium">{r.name ?? "—"}</td>
                    <td className="p-2 text-end tabular-nums">{formatMoney({ amountMinor: r.targetMinor, currency: r.currency }, locale)}</td>
                    <td className="p-2 text-end tabular-nums">{formatMoney({ amountMinor: r.wonMinor, currency: r.currency }, locale)}</td>
                    <td className="p-2">
                      <div className="flex items-center gap-2">
                        <div className="h-2 w-32 overflow-hidden rounded-sm bg-muted" aria-hidden>
                          <div className={(r.attainment ?? 0) >= 1 ? "h-full bg-success" : "h-full bg-primary"} style={{ width: `${Math.min(100, (r.attainment ?? 0) * 100)}%` }} />
                        </div>
                        <span className="tabular-nums">{pct(r.attainment)}</span>
                      </div>
                    </td>
                    <td className="p-2 text-end tabular-nums">
                      {r.dealsWon}
                      {r.dealsTarget != null ? ` / ${r.dealsTarget}` : ""}
                    </td>
                    <td className="p-2 text-end">{c.canManage ? <ActionButton url={`${base}/crm/settings/targets/${r.id}`} method="DELETE" size="icon" icon="trash" label={t("crm.delete")} confirm={t("crm.deleteConfirm")} /> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="p-4 text-sm text-muted-foreground">{t("sales.targets.none")}</p>
        )}
      </Card>
      {c.canManage ? (
        <Card>
          <CardHeader title={t("sales.targets.set")} description={t("sales.targets.setHint")} />
          <TargetForm base={base} owners={owners} period={period} periodStart={isoDay(start)!} />
        </Card>
      ) : null}
    </CrmFrame>
  );
}
