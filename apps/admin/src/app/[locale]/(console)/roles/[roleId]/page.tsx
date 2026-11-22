import Link from "next/link";
import { notFound } from "next/navigation";
import { History, KeyRound, ShieldCheck, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { AdminHeader, Avatar, EmptyState, SectionLink, guard } from "@/components/admin/kit";
import { CopyButton } from "@/components/admin/copy-button";
import { Timestamp } from "@/components/admin/timestamp";
import { CloneRoleButton, DeleteRoleButton, EditRoleButton } from "@/components/admin/people/access-admin-actions";
import { getLocale, getT } from "@/i18n/server";
import { isAppError } from "@/server/core/errors";
import { capabilitiesFor } from "@/server/modules/admin/access";
import { getPlatformRole, permissionMatrix } from "@/server/modules/admin/roles";
import { effectivePermissions } from "@/server/modules/rbac/service";
import { platformChain } from "@/server/modules/rbac/scope";
import { MFA_GATED } from "@/server/modules/rbac/catalog";
import { requestTime, requireViewer } from "@/server/session";

/** One platform role: permissions (MFA-gated marked), holders, change history; custom roles are editable. */
export default async function AdminRolePage({ params }: PageProps<"/[locale]/roles/[roleId]">) {
  const locale = await getLocale();
  const t = await getT(locale);
  const viewer = await requireViewer(locale);
  const { roleId } = await params;
  const r = await guard(
    getPlatformRole(viewer.ctx, roleId).catch((e) => {
      if (isAppError(e) && e.code === "not_found") notFound();
      throw e;
    }),
    t("errors.forbidden"),
  );
  if (!r.ok) return r.node;
  const role = r.value;
  const caps = await capabilitiesFor(viewer.ctx, ["platform.roles.manage"] as const);
  const canEdit = caps["platform.roles.manage"] && !role.builtIn;
  const [matrix, held] = caps["platform.roles.manage"] ? await Promise.all([permissionMatrix(viewer.ctx), effectivePermissions(viewer.ctx, platformChain())]) : [null, []];
  const now = requestTime();
  return (
    <div className="grid gap-4">
      <nav aria-label={t("admin.common.breadcrumb")} className="text-xs text-muted-foreground">
        <Link href={`/${locale}/roles`} className="hover:text-foreground hover:underline">
          {t("admin.nav.roles")}
        </Link>
        <span aria-hidden> / </span>
        <span>{role.name}</span>
      </nav>
      <AdminHeader
        icon={<ShieldCheck />}
        title={role.name}
        description={role.description || undefined}
        meta={
          <>
            <Badge className="font-mono">{role.key}</Badge>
            <Badge tone={role.builtIn ? "neutral" : "info"}>{role.builtIn ? t("admin.access.roles.builtIn") : t("admin.access.roles.custom")}</Badge>
            <span className="inline-flex items-center gap-1 font-mono text-[11px] text-muted-foreground">
              {role.id}
              <CopyButton value={role.id} label="ID" />
            </span>
          </>
        }
        actions={
          <>
            {caps["platform.roles.manage"] ? <CloneRoleButton source={role.builtIn ? role.key : role.id} sourceName={role.name} locale={locale} /> : null}
            {canEdit && matrix ? <EditRoleButton roleId={role.id} initial={{ name: role.name, description: role.description, permissions: role.permissions }} options={matrix.permissions} held={held} /> : null}
            {canEdit ? <DeleteRoleButton roleId={role.id} roleKey={role.key} holders={role.holders.length} locale={locale} /> : null}
            <SectionLink href={`/${locale}/roles/matrix`}>{t("admin.access.nav.matrix")}</SectionLink>
          </>
        }
      />
      {role.builtIn ? <Notice tone="info">{role.key === "SUPER_ADMIN" ? t("admin.access.roles.superImmutable") : t("admin.access.roles.builtInImmutable")}</Notice> : null}
      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader icon={<KeyRound />} title={t("admin.roles.permissions", { count: role.permissions.length })} />
          <ul className="divide-y text-xs">
            {role.permissions.map((p) => (
              <li key={p} className="flex items-center justify-between gap-2 px-4 py-1.5">
                <span className="font-mono">{p}</span>
                {MFA_GATED.has(p) ? <Badge tone="warning">MFA</Badge> : null}
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <CardHeader icon={<Users />} title={t("admin.roles.holders")} actions={<Badge tone="accent">{role.holders.length}</Badge>} />
          {role.holders.length === 0 ? (
            <EmptyState icon={<Users />} title={t("admin.roles.nobody")} />
          ) : (
            <ul className="divide-y">
              {role.holders.map((h) => (
                <li key={h.id} className="flex items-center gap-3 px-4 py-2">
                  <Avatar name={h.user?.name ?? "?"} size="sm" />
                  <div className="min-w-0 flex-1">
                    <Link href={`/${locale}/users/${h.principalId}`} className="block truncate text-sm font-medium hover:underline">
                      {h.user?.name ?? h.principalId.slice(0, 8)}
                    </Link>
                    <div className="truncate text-[11px] text-muted-foreground">
                      {h.user?.email} · {h.scopeType === "PLATFORM" ? "PLATFORM" : `${h.scopeType}:${h.scopeId}`}
                      {h.grantedBy ? ` · ${t("admin.roles.grantedBy", { name: h.grantedBy })}` : ""}
                    </div>
                  </div>
                  {h.expiresAt ? <Badge tone={h.expiresAt.getTime() <= now ? "neutral" : "warning"}>{h.expiresAt.getTime() <= now ? t("admin.access.roles.expired") : <Timestamp value={h.expiresAt} mode="relative" />}</Badge> : null}
                  {h.user && !h.user.mfaEnabled ? <Badge tone="danger">{t("admin.roles.noMfa")}</Badge> : null}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      <Card>
        <CardHeader icon={<History />} title={t("admin.access.roles.changeHistory")} />
        {role.history.length === 0 ? (
          <EmptyState icon={<History />} title={role.builtIn ? t("admin.access.roles.builtInHistory") : t("admin.access.common.noEvents")} />
        ) : (
          <ul className="divide-y text-xs">
            {role.history.map((h) => {
              const nv = (h.newValue ?? {}) as { added?: string[]; removed?: string[] };
              return (
                <li key={h.id} className="grid gap-1 px-4 py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone="warning" className="font-mono">
                      {h.action}
                    </Badge>
                    <span className="font-medium">{h.actor ?? "—"}</span>
                    <span className="ms-auto">
                      <Timestamp value={h.createdAt} />
                    </span>
                  </div>
                  {nv.added?.length ? <div className="font-mono text-success">+ {nv.added.join(", ")}</div> : null}
                  {nv.removed?.length ? <div className="font-mono text-danger">− {nv.removed.join(", ")}</div> : null}
                  {h.reason ? <div className="text-muted-foreground">“{h.reason}”</div> : null}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
