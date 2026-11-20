import type { Metadata } from "next";
import { ActionButton } from "@/components/crm/kit";
import { RangeFilter } from "@/components/crm/range-filter";
import { CommissionRuleForm } from "@/components/crm/sales-forms";
import { CrmFrame, Stat, crmContext } from "@/components/crm/shell";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { getT } from "@/i18n/server";
import { formatMoney, formatNumber } from "@/i18n/format";
import { isoDay, toMajor, userNames } from "@/server/modules/crm/common";
import { listConfig } from "@/server/modules/crm/config";
import { listPipelines } from "@/server/modules/crm/pipelines";
import { computeCommissions, parseSalesRange } from "@/server/modules/crm/sales";
import { listOwners } from "@/server/modules/crm/service";
import { db } from "@/server/core/db";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("sales.tabs.commissions") };
}

type Rule = { id: string; name: string; rateBps: number; pipelineId: string | null; ownerId: string | null; tiers: { fromMinor: string; rateBps: number }[]; active: boolean; pipeline: { name: string } | null };

export default async function CommissionsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const c = await crmContext();
  const query = await searchParams;
  if (!c.company || !c.canRead) return <CrmFrame area="sales" active="commissions">{null}</CrmFrame>;
  const { t, locale, base, org, company, viewer } = c;
  const range = parseSalesRange(query);
  const [result, rules, owners, pipelines] = await Promise.all([
    computeCommissions(viewer.ctx, org.id, company.id, range),
    listConfig(viewer.ctx, org.id, company.id, "commission-rules") as unknown as Promise<Rule[]>,
    listOwners(viewer.ctx, org.id, company.id),
    listPipelines(viewer.ctx, org.id, company.id),
  ]);
  const names = await userNames(db(), rules.map((r) => r.ownerId));
  const money = (m: bigint) => formatMoney({ amountMinor: m, currency: result.currency }, locale);
  const pct = (bps: number) => formatNumber(bps / 10_000, locale, { style: "percent", maximumFractionDigits: 2 });
  return (
    <CrmFrame area="sales" active="commissions" subtitle={t("sales.commissions.subtitle")}>
      <RangeFilter action={`/${locale}/sales/commissions`} from={isoDay(range.from)!} to={isoDay(new Date(range.to.getTime() - 86_400_000))!} owner={range.owner} owners={owners} pipeline={range.pipelineId} pipelines={pipelines} />
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label={t("sales.commissions.total")} value={money(result.totalMinor)} />
        <Stat label={t("sales.kpi.wonRevenue")} value={money(result.byOwner.reduce((s, o) => s + o.wonMinor, 0n))} />
        <Stat label={t("sales.commissions.uncovered")} value={result.uncovered} hint={t("sales.commissions.uncoveredHint")} />
      </div>
      <Card>
        <CardHeader title={t("sales.commissions.computed")} />
        {result.lines.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr className="border-b">
                  <th className="p-2 text-start font-medium">{t("crm.owner")}</th>
                  <th className="p-2 text-start font-medium">{t("sales.commissions.rule")}</th>
                  <th className="p-2 text-end font-medium">{t("sales.forecast.deals")}</th>
                  <th className="p-2 text-end font-medium">{t("sales.kpi.wonRevenue")}</th>
                  <th className="p-2 text-end font-medium">{t("sales.commissions.commission")}</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {result.lines.map((l) => (
                  <tr key={`${l.ownerId}-${l.ruleId}`}>
                    <td className="p-2 font-medium">{l.name ?? "—"}</td>
                    <td className="p-2">{l.ruleName}</td>
                    <td className="p-2 text-end tabular-nums">{l.deals}</td>
                    <td className="p-2 text-end tabular-nums">{money(l.wonMinor)}</td>
                    <td className="p-2 text-end font-medium tabular-nums">{money(l.commissionMinor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="p-4 text-sm text-muted-foreground">{rules.length ? t("sales.commissions.noWins") : t("sales.commissions.noRules")}</p>
        )}
      </Card>
      <Card>
        <CardHeader title={t("sales.commissions.rules")} description={t("sales.commissions.rulesHint")} />
        {rules.length ? (
          <ul className="grid divide-y text-sm">
            {rules.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-2 px-4 py-2">
                <span className="font-medium">{r.name}</span>
                <Badge tone={r.active ? "success" : "neutral"}>{r.active ? t("common.enabled") : t("common.disabled")}</Badge>
                <span className="tabular-nums">{pct(r.rateBps)}</span>
                <span className="min-w-0 flex-1 text-xs text-muted-foreground">
                  {[r.pipeline?.name ?? t("sales.commissions.allPipelines"), r.ownerId ? (names.get(r.ownerId) ?? "—") : t("sales.commissions.everyone")].join(" · ")}
                  {r.tiers.length ? ` · ${r.tiers.map((x) => t("sales.commissions.tierLine", { from: toMajor(BigInt(x.fromMinor), result.currency), rate: pct(x.rateBps) })).join(", ")}` : ""}
                </span>
                {c.canManage ? (
                  <>
                    <ActionButton url={`${base}/crm/settings/commission-rules/${r.id}`} method="PATCH" body={{ active: !r.active }} variant="secondary" label={r.active ? t("crm.settings.disable") : t("crm.settings.enable")} />
                    <ActionButton url={`${base}/crm/settings/commission-rules/${r.id}`} method="DELETE" size="icon" icon="trash" label={t("crm.delete")} confirm={t("crm.deleteConfirm")} />
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="p-4 text-sm text-muted-foreground">{t("sales.commissions.noRules")}</p>
        )}
        {c.canManage ? <CommissionRuleForm base={base} owners={owners} pipelines={pipelines.map((p) => ({ id: p.id, name: p.name }))} /> : <Notice tone="info" className="m-4">{t("crm.settings.readOnly")}</Notice>}
      </Card>
    </CrmFrame>
  );
}
