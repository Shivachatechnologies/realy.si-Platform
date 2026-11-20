import Link from "next/link";
import { Badge, StatusDot } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { AdminHeader, Empty, StatGrid, StatTile, guard, usd } from "@/components/admin/kit";
import { getLocale, getT } from "@/i18n/server";
import { formatDateTime, formatMoney, formatNumber } from "@/i18n/format";
import { platformOverview } from "@/server/modules/admin/overview";
import { requireViewer } from "@/server/session";

export default async function AdminOverviewPage() {
  const locale = await getLocale();
  const t = await getT(locale);
  const viewer = await requireViewer(locale);
  const r = await guard(platformOverview(viewer.ctx), t("errors.forbidden"));
  if (!r.ok) return r.node;
  const o = r.value;
  const base = `/${locale}/admin`;
  const n = (v: number) => formatNumber(v, locale);
  const queueText = o.queues.every((q) => !q.available)
    ? t("admin.overview.unavailable")
    : o.queues
        .filter((q) => q.available)
        .map((q) => `${q.name}: ${n(q.waiting)}/${n(q.active)}/${n(q.failed)}`)
        .join(" · ");
  const healthy = o.health.database && o.health.redis;
  return (
    <div className="grid gap-4">
      <AdminHeader title={t("admin.nav.overview")} description={t("admin.overviewSubtitle")} />
      <StatGrid>
        <StatTile label={t("admin.overview.users")} value={n(o.users)} hint={t("admin.overview.newUsers", { d7: n(o.registrations.d7), d30: n(o.registrations.d30) })} href={`${base}/users?created=30d`} />
        <StatTile label={t("admin.overview.activeUsers")} value={n(o.active.d7)} hint={t("admin.overview.active30", { count: n(o.active.d30) })} href={`${base}/users?login=7d`} />
        <StatTile
          label={t("admin.overview.organizations")}
          value={n(o.organizations)}
          hint={t("admin.overview.companiesSuspended", { companies: n(o.companies), suspended: n(o.suspendedOrgs) })}
          href={`${base}/organizations`}
          tone={o.suspendedOrgs ? "warning" : undefined}
        />
        <StatTile
          label={t("admin.overview.subscriptions")}
          value={n(o.subscriptions.live)}
          hint={o.mrr.length ? `${t("admin.overview.mrr")}: ${o.mrr.map((m) => formatMoney({ amountMinor: m.amountMinor, currency: m.currency }, locale)).join(" · ")}` : t("admin.overview.noMrr")}
          href={`${base}/subscriptions`}
        />
        <StatTile label={t("admin.overview.aiEmployees")} value={n(o.aiEmployees.active)} hint={t("admin.overview.paused", { count: n(o.aiEmployees.paused) })} href={`${base}/ai`} />
        <StatTile
          label={t("admin.overview.aiTasks")}
          value={n(o.tasks.running)}
          hint={t("admin.overview.tasksHint", { queued: n(o.tasks.queued), failed: n(o.tasks.failed24h) })}
          href={`${base}/ai/tasks?status=FAILED`}
          tone={o.tasks.failed24h ? "danger" : undefined}
        />
        <StatTile label={t("admin.overview.aiUsage")} value={n(o.aiMonth.tokens)} hint={t("admin.overview.aiCost", { cost: usd(o.aiMonth.costMicros, locale) })} href={`${base}/ai/usage`} />
        <StatTile label={t("admin.overview.apiUsage")} value={n(o.apiRequests30)} hint={t("admin.overview.last30")} href={`${base}/integrations`} />
        <StatTile label={t("admin.overview.approvals")} value={n(o.pendingApprovals)} hint={t("admin.overview.approvalsHint")} href={`${base}/ai/tasks`} tone={o.pendingApprovals ? "warning" : undefined} />
        <StatTile label={t("admin.overview.queues")} value={o.queues.some((q) => q.available) ? n(o.queues.reduce((a, q) => a + q.waiting, 0)) : "—"} hint={queueText} href={`${base}/system`} />
        <StatTile
          label={t("admin.overview.health")}
          value={healthy ? t("admin.overview.healthy") : t("admin.overview.degraded")}
          tone={healthy ? "success" : "danger"}
          href={`${base}/system`}
          hint={
            <span className="flex flex-wrap gap-x-2">
              {(["database", "redis", "email", "ai", "stripe"] as const).map((k) => (
                <span key={k} className="inline-flex items-center gap-1">
                  <StatusDot tone={o.health[k] ? "success" : k === "database" || k === "redis" ? "danger" : "neutral"} />
                  {t(`admin.health.${k}`)}
                </span>
              ))}
            </span>
          }
        />
      </StatGrid>
      <Card>
        <CardHeader
          title={t("admin.overview.recentActivity")}
          actions={
            <Link href={`${base}/audit`} className="text-xs underline">
              {t("admin.overview.viewAll")}
            </Link>
          }
        />
        {o.recentAdmin.length === 0 ? (
          <Empty>{t("admin.audit.empty")}</Empty>
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>{t("admin.audit.time")}</Th>
                <Th>{t("admin.audit.actor")}</Th>
                <Th>{t("admin.audit.action")}</Th>
                <Th>{t("admin.audit.reason")}</Th>
              </Tr>
            </THead>
            <TBody>
              {o.recentAdmin.map((a) => (
                <Tr key={a.id}>
                  <Td className="text-xs whitespace-nowrap text-muted-foreground">{formatDateTime(a.createdAt, locale, viewer.user.timezone)}</Td>
                  <Td className="text-xs">{a.actorEmail ?? a.actorType}</Td>
                  <Td>
                    <Badge tone={a.category === "SECURITY" ? "warning" : "accent"}>{a.action}</Badge>
                  </Td>
                  <Td className="max-w-72 truncate text-xs">{a.reason ?? ""}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
