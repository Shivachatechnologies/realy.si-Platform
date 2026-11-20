import type { Metadata } from "next";
import Link from "next/link";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { OrgChart } from "@/components/hr/org-chart";
import { loadHr, OrgFrame } from "@/components/hr/shell";
import { getLocale, getT } from "@/i18n/server";
import { buildChart, orgChartPeople } from "@/server/modules/hr/org";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("hr.org.tabs.chart") };
}

export default async function OrgChartPage() {
  const locale = await getLocale();
  const { t, viewer, org, company, access } = await loadHr(locale);
  const allowed = !!access?.read;
  if (!company || !allowed) return <OrgFrame t={t} locale={locale} tab="chart" hasCompany={!!company} allowed={allowed}>{null}</OrgFrame>;
  const people = await orgChartPeople(viewer.ctx, org.id, company.id);
  const trees = buildChart(people);
  return (
    <OrgFrame t={t} locale={locale} tab="chart" hasCompany allowed>
      <Card>
        <CardHeader title={t("hr.org.chartTitle")} description={t("hr.org.chartHint", { count: people.length })} />
        <CardBody className="overflow-x-auto">
          {trees.length ? (
            <OrgChart nodes={trees} locale={locale} reportsLabel={(n) => t("hr.org.reportsCount", { count: n })} />
          ) : (
            <p className="text-sm text-muted-foreground">
              {t("hr.org.chartEmpty")}{" "}
              <Link href={`/${locale}/hr/employees`} className="text-primary hover:underline">
                {t("hr.tabs.employees")}
              </Link>
            </p>
          )}
        </CardBody>
      </Card>
    </OrgFrame>
  );
}
