import { notFound, redirect } from "next/navigation";
import { History } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/card";
import { AdminHeader, AuditTimeline, EmptyState, SectionLink, guard } from "@/components/admin/kit";
import { OrgTabs } from "@/components/admin/people-extras";
import { getLocale, getT } from "@/i18n/server";
import { formatDateTime, formatRelativeTime } from "@/i18n/format";
import { db } from "@/server/core/db";
import { hasTenantViewGrant, organizationAccessHistory } from "@/server/modules/admin/tenants";
import { requestTime, requireViewer } from "@/server/session";

/** Who opened, impersonated into or changed access to this organization (from the audit log). */
export default async function AdminOrgAccessPage({ params }: PageProps<"/[locale]/organizations/[orgId]/access">) {
  const locale = await getLocale();
  const t = await getT(locale);
  const viewer = await requireViewer(locale);
  const { orgId } = await params;
  if (!/^[0-9a-f-]{36}$/.test(orgId)) notFound();
  const org = await db().organization.findUnique({ where: { id: orgId }, select: { name: true } });
  if (!org) notFound();
  if (!(await hasTenantViewGrant(viewer.ctx, orgId))) redirect(`/${locale}/organizations/${orgId}`);
  const r = await guard(organizationAccessHistory(viewer.ctx, orgId), t("errors.forbidden"));
  if (!r.ok) return r.node;
  const now = requestTime();
  const tz = viewer.user.timezone;
  return (
    <div className="grid gap-4">
      <OrgTabs locale={locale} orgId={orgId} active="access" />
      <AdminHeader icon={<History />} title={t("admin.access.org.accessTitle", { name: org.name })} description={t("admin.access.org.accessHint")} actions={<SectionLink href={`/${locale}/audit?org=${orgId}`}>{t("admin.access.common.openAudit")}</SectionLink>} />
      <Card>
        <CardHeader icon={<History />} title={t("admin.access.org.accessEvents", { count: r.value.length })} />
        {r.value.length === 0 ? (
          <EmptyState icon={<History />} title={t("admin.access.common.noEvents")} />
        ) : (
          <AuditTimeline
            items={r.value.map((a) => ({
              id: a.id,
              who: a.actor?.email ?? a.actorType,
              action: a.action,
              security: a.action.includes("impersonation") || a.action.startsWith("role."),
              reason: a.reason,
              iso: a.createdAt.toISOString(),
              exact: formatDateTime(a.createdAt, locale, tz),
              relative: formatRelativeTime(a.createdAt, locale, now),
            }))}
          />
        )}
      </Card>
    </div>
  );
}
