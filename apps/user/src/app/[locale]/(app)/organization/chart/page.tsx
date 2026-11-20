import type { Metadata } from "next";
import Link from "next/link";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { OrgChart } from "@/components/hr/org-chart";
import { SmartEmpty } from "@/components/guide-kit/smart-empty";
import { loadHr, OrgFrame } from "@/components/hr/shell";
import { Network } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
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
            <SmartEmpty
              icon={<Network />}
              title={t("hr.intro.chart.emptyTitle")}
              body={t("hr.org.chartEmpty")}
              primary={
                <Link href={`/${locale}/hr/employees`} className={buttonVariants({ size: "sm" })}>
                  {t("hr.intro.chart.addPeople")}
                </Link>
              }
              ai={
                <Link href={`/${locale}/hr/hire`} className={buttonVariants({ size: "sm", variant: "secondary" })}>
                  {t("hr.intro.overview.next")}
                </Link>
              }
            />
          )}
        </CardBody>
      </Card>
    </OrgFrame>
  );
}
