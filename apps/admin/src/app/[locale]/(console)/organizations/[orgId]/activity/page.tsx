import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Activity, Bot } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { AdminHeader, AuditTimeline, Empty, QuickFilters, StatGrid, StatTile, guard, sp, usd } from "@/components/admin/kit";
import { OrgTabs } from "@/components/admin/people-extras";
import { getLocale, getT } from "@/i18n/server";
import { formatDateTime, formatNumber, formatRelativeTime } from "@/i18n/format";
import { organizationActivity } from "@/server/modules/admin/people";
import { hasTenantViewGrant } from "@/server/modules/admin/tenants";
import { requireViewer } from "@/server/session";

/** Company activity: the organization's audit trail (filter by category / company), recent AI work and AI spend. */
export default async function AdminOrgActivityPage({ params, searchParams }: PageProps<"/[locale]/organizations/[orgId]/activity">) {
  const locale = await getLocale();
  const t = await getT(locale);
  const viewer = await requireViewer(locale);
  const { orgId } = await params;
  const q = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(orgId)) notFound();
  if (!(await hasTenantViewGrant(viewer.ctx, orgId))) redirect(`/${locale}/organizations/${orgId}`);
  const filters = { category: sp(q.category), company: sp(q.company) };
  const r = await guard(organizationActivity(viewer.ctx, orgId, filters), t("errors.forbidden"));
  if (!r.ok) return r.node;
  const o = r.value;
  const base = `/${locale}/organizations/${orgId}/activity`;
  const tz = viewer.user.timezone;
  return (
    <div className="grid gap-4">
      <OrgTabs locale={locale} orgId={orgId} active="activity" />
      <AdminHeader icon={<Activity />} title={t("admin.people.activityTitle", { name: o.org.name })} description={t("admin.people.activityHint")} />
      <StatGrid>
        <StatTile label={t("admin.people.events")} value={formatNumber(o.audit.length, locale)} />
        <StatTile icon={<Bot />} label={t("admin.people.recentAi")} value={formatNumber(o.tasks.length, locale)} />
        <StatTile label={t("admin.people.tokens30")} value={formatNumber(o.ai30.tokens, locale)} />
        <StatTile label={t("admin.aiModels.cost30d")} value={usd(o.ai30.costMicros, locale)} />
      </StatGrid>
      <Card>
        <QuickFilters base={base} name="category" value={filters.category} params={filters} label={t("admin.people.category")} options={[{ value: "", label: t("admin.common.all") }, ...(["TENANT", "ADMIN", "SECURITY"] as const).map((c) => ({ value: c, label: t(`admin.people.categories.${c}`) }))]} />
        <QuickFilters base={base} name="company" value={filters.company} params={filters} label={t("admin.people.company")} options={[{ value: "", label: t("admin.common.all") }, ...o.companies.map((c) => ({ value: c.id, label: c.name }))]} />
        {o.audit.length === 0 ? (
          <Empty>{t("admin.roles.viewAs.none")}</Empty>
        ) : (
          <AuditTimeline
            items={o.audit.map((a) => ({
              id: a.id,
              who: a.actorName,
              action: a.action,
              security: a.category === "SECURITY",
              reason: a.reason,
              iso: a.createdAt.toISOString(),
              exact: formatDateTime(a.createdAt, locale, tz),
              relative: formatRelativeTime(a.createdAt, locale),
              extra: <span className="font-mono text-[11px] text-muted-foreground">{a.resourceType}</span>,
            }))}
          />
        )}
      </Card>
      <Card>
        <CardHeader icon={<Bot />} title={t("admin.people.recentAi")} />
        {o.tasks.length === 0 ? (
          <Empty>{t("admin.roles.viewAs.none")}</Empty>
        ) : (
          <ul className="divide-y">
            {o.tasks.map((task) => (
              <li key={task.id} className="flex items-center justify-between gap-2 px-4 py-2 text-xs">
                <Link href={`/${locale}/ai/tasks?q=${task.id}`} className="min-w-0 truncate font-medium hover:underline">
                  {task.title}
                </Link>
                <span className="flex shrink-0 items-center gap-2 text-muted-foreground">
                  <span className="font-mono">{task.profile}</span>
                  <Badge tone={task.status === "FAILED" ? "danger" : task.status === "COMPLETED" ? "success" : "neutral"}>{task.status}</Badge>
                  {formatRelativeTime(task.createdAt, locale)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
