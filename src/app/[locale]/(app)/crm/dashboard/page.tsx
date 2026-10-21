import type { Metadata } from "next";
import Link from "next/link";
import { CrmTabs } from "@/components/crm/crm-tabs";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { getLocale, getT } from "@/i18n/server";
import { formatDate, formatMoney, formatNumber } from "@/i18n/format";
import { db } from "@/server/core/db";
import { crmDashboard } from "@/server/modules/crm/service";
import { can } from "@/server/modules/rbac/service";
import { companyChain } from "@/server/modules/rbac/scope";
import { requireOrgContext } from "@/server/workspace";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("crm.dashboard") };
}

export default async function CrmDashboardPage() {
  const locale = await getLocale();
  const t = await getT(locale);
  const { viewer, org, company } = await requireOrgContext(locale);
  const header = (
    <div className="grid gap-1">
      <h1 className="text-lg font-semibold tracking-tight">{t("modules.crm.title")}</h1>
      <p className="text-muted-foreground">{t("crm.dashboardSubtitle")}</p>
    </div>
  );
  if (!company) {
    return (
      <div className="mx-auto grid max-w-[1400px] gap-4">
        {header}
        <Card>
          <p className="p-4 text-muted-foreground">{t("company.empty")}</p>
        </Card>
      </div>
    );
  }
  const chain = await companyChain(db(), org.id, company.id);
  if (!(await can(viewer.ctx, "sales.read", chain))) {
    return (
      <div className="mx-auto grid max-w-[1400px] gap-4">
        {header}
        <Notice tone="warning">{t("errors.forbidden")}</Notice>
      </div>
    );
  }
  const d = await crmDashboard(viewer.ctx, org.id, company.id);
  const tz = company.timezone ?? "UTC";
  const money = (m: bigint) => formatMoney({ amountMinor: m, currency: company.baseCurrency }, locale);
  const pct = (v: number | null) => (v == null ? "—" : formatNumber(v, locale, { style: "percent", maximumFractionDigits: 0 }));
  const maxStage = Math.max(1, ...d.byStage.map((s) => s.count));
  const stat = (label: string, value: string, hint?: string) => (
    <Card className="p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-xl font-semibold tabular-nums">{value}</p>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </Card>
  );

  return (
    <div className="mx-auto grid max-w-[1400px] gap-4">
      {header}
      <CrmTabs locale={locale} active="dashboard" labels={{ leads: t("crm.leads"), dashboard: t("crm.dashboard") }} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {stat(t("crm.newLeads"), formatNumber(d.newLeads.last7, locale), t("crm.newLeadsHint", { count: d.newLeads.last30 }))}
        {stat(t("crm.pipelineValue"), money(d.pipeline.openValueMinor), t("crm.count", { count: d.pipeline.openCount }))}
        {stat(t("crm.weightedPipeline"), money(d.pipeline.weightedMinor))}
        {stat(t("crm.wonValue"), money(d.pipeline.wonValueMinor), t("crm.winRate", { rate: pct(d.winRate) }))}
        {stat(t("crm.overdueFollowUps"), formatNumber(d.overdue.count, locale))}
      </div>

      {d.total === 0 ? (
        <Card>
          <p className="p-4 text-muted-foreground">
            {t("crm.empty")}{" "}
            <Link href={`/${locale}/crm`} className="underline">
              {t("crm.addLead")}
            </Link>
          </p>
        </Card>
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader title={t("crm.byStage")} />
              <CardBody>
                <ul className="grid gap-2 text-sm">
                  {d.byStage.map((s) => (
                    <li key={s.stage} className="grid grid-cols-[7rem_minmax(0,1fr)_auto] items-center gap-2">
                      <Link href={`/${locale}/crm?stage=${s.stage}`} className="hover:underline">
                        {t(`crm.stages.${s.stage}`)}
                      </Link>
                      <span className="h-2 rounded-full bg-muted" aria-hidden>
                        <span className="block h-2 rounded-full bg-primary" style={{ width: `${(s.count / maxStage) * 100}%` }} />
                      </span>
                      <span className="tabular-nums text-muted-foreground">
                        {s.count} · {money(s.valueMinor)}
                      </span>
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
            <Card>
              <CardHeader title={t("crm.conversion")} description={t("crm.conversionHint")} />
              <CardBody>
                <table className="w-full text-sm">
                  <thead className="text-xs text-muted-foreground">
                    <tr className="border-b">
                      <th className="p-2 text-start font-medium">{t("crm.stage")}</th>
                      <th className="p-2 text-end font-medium">{t("crm.reached")}</th>
                      <th className="p-2 text-end font-medium">{t("crm.fromPrevious")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {d.funnel.map((f) => (
                      <tr key={f.stage}>
                        <td className="p-2">{t(`crm.stages.${f.stage}`)}</td>
                        <td className="p-2 text-end tabular-nums">{f.count}</td>
                        <td className="p-2 text-end tabular-nums">{pct(f.conversion)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardBody>
            </Card>
          </div>

          <Card>
            <CardHeader title={t("crm.ownerPerformance")} />
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground">
                  <tr className="border-b">
                    <th className="p-2 text-start font-medium">{t("crm.owner")}</th>
                    <th className="p-2 text-end font-medium">{t("crm.openLeads")}</th>
                    <th className="p-2 text-end font-medium">{t("crm.stages.WON")}</th>
                    <th className="p-2 text-end font-medium">{t("crm.stages.LOST")}</th>
                    <th className="p-2 text-end font-medium">{t("crm.winRateColumn")}</th>
                    <th className="p-2 text-end font-medium">{t("crm.wonValue")}</th>
                    <th className="p-2 text-end font-medium">{t("crm.weightedPipeline")}</th>
                    <th className="p-2 text-end font-medium">{t("crm.overdueFollowUps")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {d.owners.map((o) => (
                    <tr key={o.ownerId ?? "unassigned"}>
                      <td className="p-2">
                        <Link href={`/${locale}/crm?owner=${o.ownerId ?? "unassigned"}`} className="hover:underline">
                          {o.ownerId ? (o.name ?? "—") : t("crm.unassigned")}
                        </Link>
                      </td>
                      <td className="p-2 text-end tabular-nums">{o.open}</td>
                      <td className="p-2 text-end tabular-nums">{o.won}</td>
                      <td className="p-2 text-end tabular-nums">{o.lost}</td>
                      <td className="p-2 text-end tabular-nums">{pct(o.winRate)}</td>
                      <td className="p-2 text-end tabular-nums">{money(o.wonValueMinor)}</td>
                      <td className="p-2 text-end tabular-nums">{money(o.weightedMinor)}</td>
                      <td className={o.overdue ? "p-2 text-end tabular-nums text-warning" : "p-2 text-end tabular-nums"}>{o.overdue}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card>
            <CardHeader title={t("crm.overdueFollowUps")} description={t("crm.followUpCount", { count: d.overdue.count })} />
            {d.overdue.items.length ? (
              <ul className="grid divide-y">
                {d.overdue.items.map((f) => (
                  <li key={f.id} className="flex flex-wrap items-center gap-2 px-4 py-2 text-sm">
                    <Link href={`/${locale}/crm/${f.lead.id}`} className="font-medium hover:underline">
                      {f.lead.name}
                    </Link>
                    <span className="min-w-0 flex-1 truncate text-muted-foreground">{f.note}</span>
                    <span className="text-xs text-warning">{t("crm.overdueOn", { date: formatDate(f.dueAt, locale, tz) })}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="p-4 text-sm text-muted-foreground">{t("crm.noOverdue")}</p>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
