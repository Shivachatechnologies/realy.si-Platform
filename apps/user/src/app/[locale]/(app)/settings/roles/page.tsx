import type { Metadata } from "next";
import { AssignRoles, RoleEditor, RoleList } from "@/components/enterprise/roles";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { getLocale, getT } from "@/i18n/server";
import { isAppError } from "@/server/core/errors";
import { can, effectivePermissions } from "@/server/modules/rbac/service";
import { PLATFORM_ONLY } from "@/server/modules/rbac/catalog";
import { orgChain } from "@/server/modules/rbac/scope";
import { permissionGroups, roleBuilderData } from "@/server/modules/enterprise/roles";
import { requireOrgContext } from "@/server/workspace";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("enterprise.tabs.roles") };
}

export default async function RolesPage() {
  const locale = await getLocale();
  const t = await getT(locale);
  const { viewer, org } = await requireOrgContext(locale);
  const chain = orgChain(org.id);
  let data: Awaited<ReturnType<typeof roleBuilderData>>;
  try {
    data = await roleBuilderData(viewer.ctx, org.id);
  } catch (e) {
    if (isAppError(e) && ["forbidden", "mfa_required", "unauthenticated"].includes(e.code))
      return <Notice tone="warning">{t(`errors.${e.code === "unauthenticated" ? "forbidden" : e.code}`)}</Notice>;
    throw e;
  }
  const [canManage, canAssign, held] = await Promise.all([can(viewer.ctx, "roles.manage", chain), can(viewer.ctx, "roles.assign", chain), effectivePermissions(viewer.ctx, chain)]);
  const groups = permissionGroups();
  const grantable = held.filter((p) => !PLATFORM_ONLY.has(p));
  const custom = data.roles.filter((r) => !r.isSystem);
  const system = data.roles.filter((r) => r.isSystem);
  const mfaNeeded = (canManage || canAssign) && !viewer.user.mfaEnabled;

  return (
    <div className="grid gap-4">
      {mfaNeeded ? <Notice tone="warning">{t("enterprise.roles.mfaNotice")}</Notice> : null}
      <Card>
        <CardHeader
          title={t("enterprise.roles.customTitle")}
          description={t("enterprise.roles.customHint", {
            count: custom.length,
          })}
        />
        {custom.length ? (
          <RoleList orgId={org.id} roles={custom} groups={groups} held={grantable} canManage={canManage} />
        ) : (
          <p className="p-4 text-sm text-muted-foreground">{t("enterprise.roles.noCustom")}</p>
        )}
        {canManage ? (
          <CardBody className="grid gap-3 border-t">
            <h3 className="font-medium">{t("enterprise.roles.newRole")}</h3>
            <RoleEditor orgId={org.id} groups={groups} held={grantable} />
          </CardBody>
        ) : null}
      </Card>
      <Card>
        <CardHeader title={t("enterprise.roles.assignTitle")} description={t("enterprise.roles.assignHint")} />
        <CardBody>
          <AssignRoles
            orgId={org.id}
            members={data.members.filter((m) => m.status === "ACTIVE")}
            roles={data.roles}
            companies={data.companies}
            assignments={data.assignments.map((a) => ({
              ...a,
              expiresAt: a.expiresAt?.toISOString() ?? null,
            }))}
            canAssign={canAssign}
          />
        </CardBody>
      </Card>
      <Card>
        <CardHeader title={t("enterprise.roles.systemTitle")} description={t("enterprise.roles.systemHint")} />
        <RoleList orgId={org.id} roles={system} groups={groups} held={grantable} canManage={false} />
      </Card>
    </div>
  );
}
