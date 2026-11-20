import Link from "next/link";
import { Eye, ShieldAlert, ShieldCheck, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { AdminHeader, Avatar, SectionLink, StatGrid, StatTile, guard } from "@/components/admin/kit";
import { RoleGrant, RoleRevoke } from "@/components/admin/platform-actions";
import { getLocale, getT } from "@/i18n/server";
import { formatRelativeTime } from "@/i18n/format";
import { canPlatform } from "@/server/modules/admin/access";
import { platformRolesOverview } from "@/server/modules/admin/roles";
import { requireViewer } from "@/server/session";

/** Platform roles: who holds which admin role, grant / revoke with reason + MFA re-check. */
export default async function AdminRolesPage() {
  const locale = await getLocale();
  const t = await getT(locale);
  const viewer = await requireViewer(locale);
  const r = await guard(Promise.all([platformRolesOverview(viewer.ctx), canPlatform(viewer.ctx, "platform.security.manage")]), t("errors.forbidden"));
  if (!r.ok) return r.node;
  const [o, canManage] = r.value;
  const grantable = o.roles.filter((x) => x.grantable).map((x) => ({ key: x.key, name: x.name }));
  return (
    <div className="grid gap-4">
      <AdminHeader
        icon={<ShieldCheck />}
        title={t("admin.nav.roles")}
        description={t("admin.roles.subtitle")}
        why={t("admin.roles.why")}
        actions={
          <>
            <SectionLink href={`/${locale}/roles/view-as`}>{t("admin.nav.viewAs")}</SectionLink>
            {canManage ? <RoleGrant roles={grantable} /> : null}
          </>
        }
      />
      <StatGrid>
        <StatTile icon={<Users />} label={t("admin.roles.holders")} value={o.holders} />
        <StatTile icon={<ShieldCheck />} label={t("admin.roles.superAdmins")} value={o.roles.find((x) => x.key === "SUPER_ADMIN")?.holders.length ?? 0} />
        <StatTile icon={<ShieldAlert />} label={t("admin.roles.withoutMfa")} value={o.withoutMfa} tone={o.withoutMfa ? "danger" : "success"} />
        <StatTile icon={<Eye />} label={t("admin.roles.roleCount")} value={o.roles.length} />
      </StatGrid>
      {o.withoutMfa ? <Notice tone="danger">{t("admin.roles.withoutMfaHint")}</Notice> : null}
      <div className="grid gap-4 lg:grid-cols-2">
        {o.roles.map((role) => (
          <Card key={role.key}>
            <CardHeader title={<span className="flex items-center gap-2">{role.name}<Badge className="font-mono">{role.key}</Badge></span>} description={role.description} actions={<Badge tone="accent">{role.holders.length}</Badge>} />
            <details className="border-b px-4 py-2 text-xs">
              <summary className="cursor-pointer text-muted-foreground">{t("admin.roles.permissions", { count: role.permissions.length })}</summary>
              <div className="mt-2 flex flex-wrap gap-1">
                {role.permissions.map((p) => (
                  <span key={p} className="rounded-sm border bg-surface-2 px-1 font-mono text-[10px]">
                    {p}
                  </span>
                ))}
              </div>
            </details>
            {role.holders.length === 0 ? (
              <p className="p-4 text-xs text-muted-foreground">{t("admin.roles.nobody")}</p>
            ) : (
              <ul className="divide-y">
                {role.holders.map((h) => (
                  <li key={h.assignmentId} className="flex items-center gap-3 px-4 py-2">
                    <Avatar name={h.user?.name ?? "?"} size="sm" />
                    <div className="min-w-0 flex-1">
                      <Link href={`/${locale}/users/${h.userId}`} className="block truncate text-sm font-medium hover:underline">
                        {h.user?.name ?? h.userId.slice(0, 8)}
                      </Link>
                      <div className="truncate text-[11px] text-muted-foreground">
                        {h.user?.email} · {h.scope !== "PLATFORM" ? `${h.scope} · ` : ""}
                        {formatRelativeTime(h.createdAt, locale)}
                        {h.grantedBy ? ` · ${t("admin.roles.grantedBy", { name: h.grantedBy })}` : ""}
                      </div>
                    </div>
                    {h.user && !h.user.mfaEnabled ? <Badge tone="danger">{t("admin.roles.noMfa")}</Badge> : null}
                    {canManage && role.grantable ? <RoleRevoke assignmentId={h.assignmentId} who={h.user?.name ?? ""} role={role.name} /> : null}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}
