import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Notice } from "@/components/ui/notice";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { CustomRoleForm, InviteForm, PendingInvitations } from "@/components/settings/members";
import { getLocale, getT } from "@/i18n/server";
import { isAppError } from "@/server/core/errors";
import { listInvitations, listMembers } from "@/server/modules/organizations/service";
import { can, effectivePermissions, listRoles } from "@/server/modules/rbac/service";
import { PLATFORM_ONLY } from "@/server/modules/rbac/catalog";
import { orgChain } from "@/server/modules/rbac/scope";
import { requireOrgContext } from "@/server/workspace";

export default async function MembersPage() {
  const locale = await getLocale();
  const t = await getT(locale);
  const { viewer, org } = await requireOrgContext(locale);
  const chain = orgChain(org.id);

  let members: Awaited<ReturnType<typeof listMembers>>;
  try {
    members = await listMembers(viewer.ctx, org.id);
  } catch (e) {
    if (isAppError(e) && e.code === "forbidden") return <Notice tone="warning">{t("errors.forbidden")}</Notice>;
    throw e;
  }
  const [invitations, roles, canInvite, canManageRoles, held] = await Promise.all([
    listInvitations(viewer.ctx, org.id),
    listRoles(viewer.ctx, org.id).catch(() => []),
    can(viewer.ctx, "users.manage", chain),
    can(viewer.ctx, "roles.manage", chain),
    effectivePermissions(viewer.ctx, chain),
  ]);
  const roleOptions = roles.map((r) => ({ id: r.id, key: r.key, name: r.name, isSystem: r.isSystem, assignableAt: r.assignableAt }));

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader title={t("settings.members.title")} />
        <Table>
          <THead>
            <Tr>
              <Th>{t("auth.name")}</Th>
              <Th>{t("auth.email")}</Th>
              <Th>{t("settings.members.roles")}</Th>
              <Th>{t("settings.members.mfa")}</Th>
            </Tr>
          </THead>
          <TBody>
            {members.map((m) => (
              <Tr key={m.userId}>
                <Td className="font-medium">{m.name}</Td>
                <Td className="text-muted-foreground">{m.email}</Td>
                <Td>
                  <div className="flex flex-wrap gap-1">
                    {m.roles.map((r) => (
                      <Badge key={r.assignmentId} tone="accent" title={`${r.scopeType}:${r.scopeId}`}>
                        {r.name}
                      </Badge>
                    ))}
                  </div>
                </Td>
                <Td>{m.mfaEnabled ? <Badge tone="success">{t("common.enabled")}</Badge> : <Badge>{t("common.disabled")}</Badge>}</Td>
              </Tr>
            ))}
          </TBody>
        </Table>
        {canInvite ? (
          <CardBody className="border-t">
            <InviteForm orgId={org.id} roles={roleOptions} />
          </CardBody>
        ) : null}
      </Card>

      {invitations.length > 0 ? (
        <Card>
          <CardHeader title={t("settings.members.pending")} />
          <PendingInvitations
            orgId={org.id}
            canManage={canInvite}
            invitations={invitations.map((i) => ({ id: i.id, email: i.email, roleName: i.role.name, expiresAt: i.expiresAt.toISOString(), deliveryStatus: i.deliveryStatus }))}
          />
        </Card>
      ) : null}

      <Card>
        <CardHeader title={t("settings.members.roles")} />
        <ul className="divide-y">
          {roles.map((r) => (
            <li key={r.id} className="flex items-center gap-3 px-4 py-2">
              <span className="font-medium">{r.name}</span>
              <Badge>{r.isSystem ? t("settings.members.system") : t("settings.members.custom")}</Badge>
              <span className="ms-auto text-xs text-muted-foreground">{t("settings.members.permissionCount", { count: r.permissions.length })}</span>
            </li>
          ))}
        </ul>
        {canManageRoles ? (
          <CardBody className="grid gap-3 border-t">
            <h3 className="font-medium">{t("settings.members.newRole")}</h3>
            <CustomRoleForm orgId={org.id} permissions={held.filter((p) => !PLATFORM_ONLY.has(p))} />
          </CardBody>
        ) : null}
      </Card>
    </div>
  );
}
