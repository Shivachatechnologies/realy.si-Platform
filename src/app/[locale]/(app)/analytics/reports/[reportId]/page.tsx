import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Download, Trash2 } from "lucide-react";
import { EditReportDialog } from "@/components/bi/edit-dialog";
import { formatChange, formatMetric } from "@/components/bi/format";
import { ActionButton } from "@/components/workforce/action-button";
import { PageHeader } from "@/components/workforce/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { getLocale, getT } from "@/i18n/server";
import { formatDate } from "@/i18n/format";
import { db } from "@/server/core/db";
import { isAppError } from "@/server/core/errors";
import { isoDay } from "@/server/modules/bi/range";
import { runReport } from "@/server/modules/bi/report-run";
import { BI_DEPARTMENTS, metricContext } from "@/server/modules/bi/service";
import { can } from "@/server/modules/rbac/service";
import { companyChain } from "@/server/modules/rbac/scope";
import { requireOrgContext } from "@/server/workspace";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("analytics.reports.title") };
}

export default async function ReportPage({ params }: PageProps<"/[locale]/analytics/reports/[reportId]">) {
  const { reportId } = await params;
  const locale = await getLocale();
  const t = await getT(locale);
  const { viewer, org, company } = await requireOrgContext(locale);
  if (!company) notFound();
  const r = await runReport(viewer.ctx, org.id, company.id, reportId).catch((err) => {
    if (isAppError(err) && (err.code === "not_found" || err.code === "forbidden")) notFound();
    throw err;
  });
  const chain = await companyChain(db(), org.id, company.id);
  const canManage = await can(viewer.ctx, "analytics.manage", chain);
  const { metrics } = canManage ? await metricContext(viewer.ctx, org.id, company.id) : { metrics: [] };
  const options = BI_DEPARTMENTS.flatMap((d) => metrics.filter((m) => m.department === d).map((m) => ({ key: m.key, label: t(m.labelKey), group: t(`analytics.departments.${d}`) })));
  const apiBase = `/api/v1/organizations/${org.id}/companies/${company.id}`;
  const fmt = (v: number | null, i: number) => formatMetric(v, r.metrics[i]!.unit, locale, r.currency);
  const period = `${formatDate(r.range.from, locale, "UTC")} – ${formatDate(new Date(r.range.to.getTime() - 1), locale, "UTC")}`;

  return (
    <div className="mx-auto grid max-w-[1400px] gap-4">
      <Link href={`/${locale}/analytics/reports`} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft aria-hidden className="size-4 rtl:rotate-180" />
        {t("analytics.reports.back")}
      </Link>
      <PageHeader
        title={r.report.name}
        subtitle={`${r.report.description ? `${r.report.description} · ` : ""}${t(`analytics.range.${r.report.range}`)} · ${period}`}
        actions={
          <>
            <Button asChild size="sm" variant="secondary">
              <a href={`${apiBase}/analytics/reports/${r.report.id}/csv`} download>
                <Download aria-hidden />
                {t("analytics.reports.csv")}
              </a>
            </Button>
            {canManage ? (
              <>
                <EditReportDialog
                  apiBase={apiBase}
                  metrics={options}
                  reportId={r.report.id}
                  label={t("analytics.reports.edit")}
                  initial={{
                    name: r.report.name,
                    description: r.report.description ?? "",
                    metricKeys: r.report.metricKeys,
                    range: r.report.range as "30d",
                    customFrom: r.report.customFrom ? isoDay(r.report.customFrom) : "",
                    customTo: r.report.customTo ? isoDay(r.report.customTo) : "",
                    bucketed: r.report.bucketed,
                    shared: r.report.shared,
                  }}
                />
                <ActionButton path={`${apiBase}/analytics/reports/${r.report.id}`} method="DELETE" variant="ghost" confirm={t("analytics.reports.confirmDelete", { name: r.report.name })} redirectTo="/analytics/reports">
                  <Trash2 aria-hidden />
                  {t("analytics.reports.delete")}
                </ActionButton>
              </>
            ) : null}
          </>
        }
      />
      {r.hidden ? <Notice tone="warning">{t("analytics.reports.hidden", { count: r.hidden })}</Notice> : null}
      <Card>
        <CardHeader title={t("analytics.reports.totals")} />
        <Table>
          <THead>
            <Tr>
              <Th>{t("analytics.reports.metric")}</Th>
              <Th className="text-end">{t("analytics.value")}</Th>
              <Th className="text-end">{t("analytics.reports.previous")}</Th>
              <Th className="text-end">{t("analytics.reports.change")}</Th>
            </Tr>
          </THead>
          <TBody>
            {r.totals.map((row, i) => (
              <Tr key={row.key}>
                <Td>
                  {r.metrics[i]!.href ? (
                    <Link className="hover:underline" href={`/${locale}${r.metrics[i]!.href}`}>
                      {t(r.metrics[i]!.labelKey)}
                    </Link>
                  ) : (
                    t(r.metrics[i]!.labelKey)
                  )}
                </Td>
                <Td className="tabular text-end">{fmt(row.value, i)}</Td>
                <Td className="tabular text-end text-muted-foreground">{fmt(row.previous, i)}</Td>
                <Td className="tabular text-end">{formatChange(row.changePct, locale) ?? "—"}</Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      </Card>
      {r.buckets ? (
        <Card>
          <CardHeader title={t("analytics.reports.byPeriod")} />
          <Table>
            <THead>
              <Tr>
                <Th>{t("analytics.period")}</Th>
                {r.metrics.map((m) => (
                  <Th key={m.key} className="text-end">
                    {t(m.labelKey)}
                  </Th>
                ))}
              </Tr>
            </THead>
            <TBody>
              {r.buckets.map((b) => (
                <Tr key={b.from.toISOString()}>
                  <Td className="whitespace-nowrap">{formatDate(b.from, locale, "UTC")}</Td>
                  {b.values.map((v, i) => (
                    <Td key={i} className="tabular text-end">
                      {fmt(v, i)}
                    </Td>
                  ))}
                </Tr>
              ))}
            </TBody>
          </Table>
        </Card>
      ) : null}
    </div>
  );
}
