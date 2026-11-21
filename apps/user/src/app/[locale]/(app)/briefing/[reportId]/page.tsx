import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { BriefingTabs } from "@/components/briefing/briefing-tabs";
import { BriefingView } from "@/components/briefing/briefing-view";
import { pendingApprovalIds } from "@/components/briefing/load";
import { ReportMasthead } from "@/components/briefing/report-masthead";
import { Notice } from "@/components/ui/notice";
import { PageHeader } from "@/components/ui/page-header";
import { getLocale, getT } from "@/i18n/server";
import { db } from "@/server/core/db";
import { AppError } from "@/server/core/errors";
import { getReport } from "@/server/modules/briefing/service";
import { can } from "@/server/modules/rbac/service";
import { companyChain } from "@/server/modules/rbac/scope";
import { requireOrgContext } from "@/server/workspace";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("briefing.title") };
}

export default async function BriefingReportPage({ params }: PageProps<"/[locale]/briefing/[reportId]">) {
  const { reportId } = await params;
  const locale = await getLocale();
  const t = await getT(locale);
  const { viewer, org, company } = await requireOrgContext(locale);
  if (!company) notFound();
  const chain = await companyChain(db(), org.id, company.id);
  const header = (
    <PageHeader variant="editorial" world="command" eyebrow={t("briefing.eyebrow")} title={t("briefing.title")} illustration={false}>
      <BriefingTabs locale={locale} active={null} />
    </PageHeader>
  );
  if (!(await can(viewer.ctx, "analytics.read", chain))) {
    return (
      <div className="mx-auto grid max-w-[1400px] gap-6">
        {header}
        <Notice tone="warning">{t("briefing.forbidden")}</Notice>
      </div>
    );
  }
  let report: Awaited<ReturnType<typeof getReport>>;
  try {
    report = await getReport(viewer.ctx, org.id, company.id, reportId);
  } catch (err) {
    if (err instanceof AppError && err.code === "not_found") notFound();
    throw err;
  }
  const canDecide = await can(viewer.ctx, "approvals.decide", chain);
  const pendingIds = await pendingApprovalIds(org.id, company.id, report.data.approvals?.items.map((a) => a.id) ?? []);
  return (
    <div className="mx-auto grid max-w-[1400px] gap-8">
      {header}
      <Link href={`/${locale}/briefing/history`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4 rtl:-scale-x-100" aria-hidden />
        {t("briefing.tabs.history")}
      </Link>
      <ReportMasthead data={report.data} t={t} locale={locale} deliveries={report.deliveries.map((d) => ({ channel: d.channel, status: d.status, error: d.error }))} />
      <BriefingView data={report.data} summary={report.summary} summaryStatus={report.summaryStatus} t={t} locale={locale} apiBase={`/api/v1/organizations/${org.id}/companies/${company.id}`} pendingIds={pendingIds} canDecide={canDecide} />
    </div>
  );
}
