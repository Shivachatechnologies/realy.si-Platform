import type { Metadata } from "next";
import Link from "next/link";
import { DashboardForm } from "@/components/bi/dashboard-form";
import { AnalyticsHeader } from "@/components/bi/shell";
import { PageState } from "@/components/workforce/states";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { getLocale, getT } from "@/i18n/server";
import { formatRelativeTime } from "@/i18n/format";
import { db } from "@/server/core/db";
import { listDashboards } from "@/server/modules/bi/dashboards";
import { can } from "@/server/modules/rbac/service";
import { companyChain } from "@/server/modules/rbac/scope";
import { requireOrgContext } from "@/server/workspace";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("analytics.dashboards.title") };
}

export default async function DashboardsPage() {
  const locale = await getLocale();
  const t = await getT(locale);
  const { viewer, org, company } = await requireOrgContext(locale);
  const header = <AnalyticsHeader t={t} locale={locale} active="dashboards" title={t("analytics.dashboards.title")} subtitle={t("analytics.dashboards.subtitle")} />;
  if (!company) return <PageState header={header} kind="empty" message={t("company.empty")} />;
  const chain = await companyChain(db(), org.id, company.id);
  const [canRead, canManage] = await Promise.all([can(viewer.ctx, "analytics.read", chain), can(viewer.ctx, "analytics.manage", chain)]);
  if (!canRead) return <PageState header={header} kind="forbidden" message={t("errors.forbidden")} />;
  const dashboards = await listDashboards(viewer.ctx, org.id, company.id);
  const apiBase = `/api/v1/organizations/${org.id}/companies/${company.id}`;

  return (
    <div className="mx-auto grid max-w-[1400px] gap-4">
      {header}
      {canManage ? (
        <Card>
          <CardHeader title={t("analytics.dashboards.new")} />
          <CardBody>
            <DashboardForm apiBase={apiBase} />
          </CardBody>
        </Card>
      ) : null}
      {dashboards.length === 0 ? (
        <Card>
          <CardBody className="text-sm text-muted-foreground">{t("analytics.dashboards.empty")}</CardBody>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {dashboards.map((d) => (
            <Link key={d.id} href={`/${locale}/analytics/dashboards/${d.id}`} className="grid gap-1 rounded-lg border bg-surface p-4 hover:bg-muted/50">
              <span className="flex items-center justify-between gap-2 font-medium">
                <span className="truncate">{d.name}</span>
                <Badge tone={d.shared ? "accent" : "neutral"}>{d.shared ? t("analytics.dashboards.shared") : t("analytics.dashboards.private")}</Badge>
              </span>
              {d.description ? <span className="line-clamp-2 text-sm text-muted-foreground">{d.description}</span> : null}
              <span className="text-xs text-muted-foreground">
                {t("analytics.dashboards.widgetCount", { count: d._count.widgets })} · {formatRelativeTime(d.updatedAt, locale)}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
