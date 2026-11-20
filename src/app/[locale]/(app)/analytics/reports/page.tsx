import type { Metadata } from "next";
import Link from "next/link";
import { ReportForm } from "@/components/bi/report-form";
import { AnalyticsHeader } from "@/components/bi/shell";
import { PageState } from "@/components/workforce/states";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { getLocale, getT } from "@/i18n/server";
import { formatRelativeTime } from "@/i18n/format";
import { db } from "@/server/core/db";
import { listReports } from "@/server/modules/bi/dashboards";
import { BI_DEPARTMENTS, metricContext } from "@/server/modules/bi/service";
import { can } from "@/server/modules/rbac/service";
import { companyChain } from "@/server/modules/rbac/scope";
import { requireOrgContext } from "@/server/workspace";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("analytics.reports.title") };
}

export default async function ReportsPage() {
  const locale = await getLocale();
  const t = await getT(locale);
  const { viewer, org, company } = await requireOrgContext(locale);
  const header = <AnalyticsHeader t={t} locale={locale} active="reports" title={t("analytics.reports.title")} subtitle={t("analytics.reports.subtitle")} />;
  if (!company) return <PageState header={header} kind="empty" message={t("company.empty")} />;
  const chain = await companyChain(db(), org.id, company.id);
  const [canRead, canManage] = await Promise.all([can(viewer.ctx, "analytics.read", chain), can(viewer.ctx, "analytics.manage", chain)]);
  if (!canRead) return <PageState header={header} kind="forbidden" message={t("errors.forbidden")} />;
  const [reports, { metrics }] = await Promise.all([listReports(viewer.ctx, org.id, company.id), metricContext(viewer.ctx, org.id, company.id)]);
  const apiBase = `/api/v1/organizations/${org.id}/companies/${company.id}`;
  const options = BI_DEPARTMENTS.flatMap((d) => metrics.filter((m) => m.department === d).map((m) => ({ key: m.key, label: t(m.labelKey), group: t(`analytics.departments.${d}`) })));

  return (
    <div className="mx-auto grid max-w-[1400px] gap-4">
      {header}
      {canManage ? (
        <Card>
          <CardHeader title={t("analytics.reports.new")} />
          <CardBody>
            <ReportForm apiBase={apiBase} metrics={options} />
          </CardBody>
        </Card>
      ) : null}
      <Card>
        <CardHeader title={t("analytics.reports.list")} />
        {reports.length === 0 ? (
          <CardBody className="text-sm text-muted-foreground">{t("analytics.reports.empty")}</CardBody>
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>{t("analytics.reports.name")}</Th>
                <Th>{t("analytics.reports.metrics")}</Th>
                <Th>{t("analytics.range.label")}</Th>
                <Th>{t("analytics.reports.updated")}</Th>
              </Tr>
            </THead>
            <TBody>
              {reports.map((r) => (
                <Tr key={r.id}>
                  <Td className="font-medium">
                    <Link className="hover:underline" href={`/${locale}/analytics/reports/${r.id}`}>
                      {r.name}
                    </Link>
                    {r.description ? <div className="text-xs font-normal text-muted-foreground">{r.description}</div> : null}
                  </Td>
                  <Td className="tabular">{r.metricKeys.length}</Td>
                  <Td>{t(`analytics.range.${r.range}`)}</Td>
                  <Td className="text-muted-foreground">{formatRelativeTime(r.updatedAt, locale)}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
