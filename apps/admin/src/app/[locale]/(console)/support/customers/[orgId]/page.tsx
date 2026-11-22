import Link from "next/link";
import { notFound } from "next/navigation";
import { Activity, AlertTriangle, CreditCard, HeartPulse, LifeBuoy, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { AdminHeader, Facts, StatGrid, StatTile, guard } from "@/components/admin/kit";
import { AdminBreadcrumbs } from "@/components/admin/nav/breadcrumbs";
import { StatusBadge } from "@/components/admin/status-badge";
import { Timestamp } from "@/components/admin/timestamp";
import { SourceNote, pct } from "@/components/admin/security/page-kit";
import { getLocale, getT } from "@/i18n/server";
import { formatNumber } from "@/i18n/format";
import { isAppError } from "@/server/core/errors";
import { customerHealth } from "@/server/modules/admin/support";
import { requireViewer } from "@/server/session";

/** Customer health for support: usage, subscription, activity, support history, adoption and named risk signals. */
export default async function CustomerHealthPage({ params }: PageProps<"/[locale]/support/customers/[orgId]">) {
  const { orgId } = await params;
  const locale = await getLocale();
  const t = await getT(locale);
  const viewer = await requireViewer(locale);
  let r;
  try {
    r = await guard(customerHealth(viewer.ctx, orgId), t("errors.forbidden"));
  } catch (e) {
    if (isAppError(e) && e.code === "not_found") notFound();
    throw e;
  }
  if (!r.ok) return r.node;
  const h = r.value;
  const base = `/${locale}`;
  const n = (v: number) => formatNumber(v, locale);
  return (
    <div className="grid gap-4">
      <AdminBreadcrumbs extra={[{ label: t("admin.support.health.title"), href: `${base}/support` }, { label: h.organization.name }]} />
      <AdminHeader
        icon={<HeartPulse />}
        title={h.organization.name}
        description={t("admin.support.health.subtitle")}
        why={t("admin.support.health.why")}
        actions={
          <>
            <Link href={`${base}/organizations/${h.organization.id}`} className="text-xs text-primary hover:underline">
              {t("admin.support.health.openOrg")}
            </Link>
            <Link href={`${base}/support?org=${h.organization.id}&status=all`} className="text-xs text-primary hover:underline">
              {t("admin.support.health.allTickets")}
            </Link>
          </>
        }
        meta={<SourceNote source="memberships · sessions · subscriptions · usage_records · agent_tasks · platform_support_tickets" at={new Date()} label={{ source: t("admin.settings.kit.source"), updated: t("admin.settings.kit.updated") }} />}
      />
      <Card>
        <CardHeader icon={<AlertTriangle />} title={t("admin.support.health.risks")} description={t("admin.support.health.risksHint")} />
        {h.risks.length ? (
          <ul className="grid gap-2 p-4 sm:grid-cols-2">
            {h.risks.map((x) => (
              <li key={x.key} className="flex items-start gap-2 rounded-md border p-2 text-sm">
                <Badge tone={x.severity === "high" ? "danger" : "warning"}>{t(`admin.support.health.severity.${x.severity}`)}</Badge>
                <span>{t(`admin.support.health.risk.${x.key}`)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="p-4 text-sm text-muted-foreground">{t("admin.support.health.noRisks")}</p>
        )}
      </Card>
      <StatGrid>
        <StatTile icon={<Users />} label={t("admin.support.health.activeMembers")} value={`${n(h.usage.activeMembers7d)} / ${n(h.usage.members)}`} hint={pct(h.adoption.activeShare, locale) ?? t("admin.settings.kit.noData")} />
        <StatTile icon={<Activity />} label={t("admin.support.health.apiRequests")} value={n(h.usage.apiRequests30d)} hint={t("admin.settings.kit.last30d")} />
        <StatTile label={t("admin.support.health.aiTasks")} value={n(h.usage.aiTasks30d)} hint={t("admin.support.health.aiFailed", { count: h.usage.aiFailed30d })} tone={h.usage.aiFailed30d ? "warning" : undefined} />
        <StatTile icon={<LifeBuoy />} label={t("admin.support.health.openTickets")} value={n(h.support.open)} hint={t("admin.support.health.totalTickets", { count: h.support.total })} href={`${base}/support?org=${h.organization.id}`} />
      </StatGrid>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader icon={<CreditCard />} title={t("admin.support.health.subscription")} />
          {h.subscription ? (
            <Facts
              rows={[
                [t("admin.support.health.plan"), h.subscription.plan.name],
                [t("admin.support.status"), <StatusBadge key="s" domain="subscription" value={h.subscription.status} />],
                [t("admin.support.health.interval"), h.subscription.interval],
                [t("admin.support.health.periodEnd"), h.subscription.currentPeriodEnd ? <Timestamp key="p" value={h.subscription.currentPeriodEnd} mode="absolute" /> : "—"],
                [t("admin.support.health.cancelling"), h.subscription.cancelAtPeriodEnd ? t("common.yes") : t("common.no")],
                [t("admin.support.health.paymentFailed"), h.subscription.lastPaymentFailedAt ? <Timestamp key="f" value={h.subscription.lastPaymentFailedAt} /> : "—"],
              ]}
            />
          ) : (
            <p className="p-4 text-sm text-muted-foreground">{t("admin.support.health.noSubscription")}</p>
          )}
        </Card>
        <Card>
          <CardHeader title={t("admin.support.health.adoption")} />
          <Facts
            rows={[
              [t("admin.support.health.companies"), n(h.adoption.companies)],
              [t("admin.support.health.aiEmployees"), n(h.adoption.aiEmployees)],
              [t("admin.support.health.integrations"), `${n(h.adoption.integrationsConnected)} · ${t("admin.support.health.integrationErrors", { count: h.adoption.integrationsError })}`],
              [t("admin.support.health.lastSeen"), h.activity.lastSeenAt ? <Timestamp key="l" value={h.activity.lastSeenAt} /> : t("admin.settings.kit.noData")],
              [t("admin.support.health.auditEvents"), n(h.activity.auditEvents30d)],
              [t("admin.support.health.orgStatus"), <StatusBadge key="o" domain="organization" value={h.organization.status} />],
            ]}
          />
        </Card>
      </div>
    </div>
  );
}
