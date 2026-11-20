import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { AdminHeader, Avatar, guard } from "@/components/admin/kit";
import { AddMember, MemberRole } from "@/components/admin/people-actions";
import { OrgTabs } from "@/components/admin/people-extras";
import { getLocale, getT } from "@/i18n/server";
import { formatDate } from "@/i18n/format";
import { db } from "@/server/core/db";
import { canPlatform } from "@/server/modules/admin/access";
import { organizationMembers } from "@/server/modules/admin/people";
import { hasTenantViewGrant } from "@/server/modules/admin/tenants";
import { requireViewer } from "@/server/session";

const ORG_ROLES = ["ORGANIZATION_OWNER", "ORGANIZATION_ADMIN", "MEMBER"];

/** Owners, members and organization roles (add / change role / remove; keeps at least one owner). */
export default async function AdminOrgMembersPage({ params }: PageProps<"/[locale]/organizations/[orgId]/members">) {
  const locale = await getLocale();
  const t = await getT(locale);
  const viewer = await requireViewer(locale);
  const { orgId } = await params;
  if (!/^[0-9a-f-]{36}$/.test(orgId)) notFound();
  const org = await db().organization.findUnique({ where: { id: orgId }, select: { name: true } });
  if (!org) notFound();
  // Same audited reason gate as the overview: open the organization once with a reason, then the tabs.
  if (!(await hasTenantViewGrant(viewer.ctx, orgId))) redirect(`/${locale}/organizations/${orgId}`);
  const r = await guard(Promise.all([organizationMembers(viewer.ctx, orgId), canPlatform(viewer.ctx, "platform.organizations.manage")]), t("errors.forbidden"));
  if (!r.ok) return r.node;
  const [members, canManage] = r.value;
  return (
    <div className="grid gap-4">
      <OrgTabs locale={locale} orgId={orgId} active="members" />
      <AdminHeader icon={<Users />} title={t("admin.people.membersTitle", { name: org.name })} description={t("admin.people.membersHint")} actions={canManage ? <AddMember organizationId={orgId} /> : null} />
      {members.filter((m) => m.roles.includes("ORGANIZATION_OWNER")).length === 0 ? <Notice tone="warning">{t("admin.people.noOwner")}</Notice> : null}
      <Card>
        <CardHeader title={t("admin.people.tabs.members")} description={t("admin.people.memberCount", { count: members.length })} />
        <Table>
          <THead>
            <Tr>
              <Th>{t("admin.people.name")}</Th>
              <Th>{t("admin.roles.role")}</Th>
              <Th>{t("admin.users.columns.status")}</Th>
              <Th>{t("admin.people.joined")}</Th>
              <Th className="text-end">{t("admin.common.actions")}</Th>
            </Tr>
          </THead>
          <TBody>
            {members.map((m) => {
              const orgRole = ORG_ROLES.find((r) => m.roles.includes(r)) ?? null;
              return (
                <Tr key={m.user.id}>
                  <Td>
                    <div className="flex items-center gap-2">
                      <Avatar name={m.user.name} size="sm" />
                      <div className="min-w-0">
                        <Link href={`/${locale}/users/${m.user.id}`} className="block truncate font-medium hover:underline">
                          {m.user.name}
                        </Link>
                        <div className="truncate text-[11px] text-muted-foreground">{m.user.email}</div>
                      </div>
                    </div>
                  </Td>
                  <Td>
                    <span className="flex flex-wrap gap-1">
                      {m.roles.map((x) => (
                        <Badge key={x} tone={x === "ORGANIZATION_OWNER" ? "accent" : "neutral"} className="font-mono">
                          {x}
                        </Badge>
                      ))}
                    </span>
                  </Td>
                  <Td>
                    <Badge tone={m.status === "ACTIVE" ? "success" : "warning"}>{m.status}</Badge>
                    {!m.user.mfaEnabled ? <div className="text-[11px] text-muted-foreground">{t("admin.roles.noMfa")}</div> : null}
                  </Td>
                  <Td className="text-xs text-muted-foreground">{formatDate(m.createdAt, locale, viewer.user.timezone)}</Td>
                  <Td className="text-end">{canManage ? <MemberRole organizationId={orgId} userId={m.user.id} name={m.user.name} current={orgRole} /> : null}</Td>
                </Tr>
              );
            })}
          </TBody>
        </Table>
      </Card>
    </div>
  );

}
