import Link from "next/link";
import { Clock, Eye, Flame, Grid3x3, History, ListChecks, ShieldAlert, ShieldCheck, Users, VenetianMask } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { AdminHeader, Avatar, SectionLink, StatGrid, StatTile, guard } from "@/components/admin/kit";
import { Timestamp } from "@/components/admin/timestamp";
import { RoleGrant, RoleRevoke } from "@/components/admin/people/role-actions";
import { BreakGlassButton, CloneRoleButton, CreateRoleButton } from "@/components/admin/people/access-admin-actions";
import { getLocale, getT } from "@/i18n/server";
import { formatRelativeTime } from "@/i18n/format";
import { capabilitiesFor } from "@/server/modules/admin/access";
import { BREAK_GLASS_MAX_MINUTES, BREAK_GLASS_PHRASE, breakGlassState, permissionMatrix, platformRolesOverview } from "@/server/modules/admin/roles";
import { effectivePermissions } from "@/server/modules/rbac/service";
import { platformChain } from "@/server/modules/rbac/scope";
import { requestTime, requireViewer } from "@/server/session";

type Holder = { assignmentId: string; scope: string; createdAt: Date; expiresAt: Date | null; user: { name: string; email: string; mfaEnabled: boolean } | null | undefined; grantedBy: string | null; userId: string };

/** Platform roles: built-in and custom roles, holders (temporary grants marked), grant / revoke, break-glass, links. */
export default async function AdminRolesPage() {
  const locale = await getLocale();
  const t = await getT(locale);
  const viewer = await requireViewer(locale);
  const r = await guard(Promise.all([platformRolesOverview(viewer.ctx), breakGlassState(viewer.ctx).catch(() => [])]), t("errors.forbidden"));
  if (!r.ok) return r.node;
  const [o, breakGlass] = r.value;
  const caps = await capabilitiesFor(viewer.ctx, ["platform.security.manage", "platform.roles.manage"] as const);
  const canManage = caps["platform.security.manage"];
  const canRoles = caps["platform.roles.manage"];
  const [matrix, held] = canRoles ? await Promise.all([permissionMatrix(viewer.ctx), effectivePermissions(viewer.ctx, platformChain())]) : [null, []];
  const grantable = [...o.roles.filter((x) => x.grantable).map((x) => ({ key: x.key, name: x.name })), ...o.custom.map((c) => ({ key: c.key, name: `${c.name} (${t("admin.access.roles.custom")})` }))];
  const activeGlass = breakGlass.filter((b) => b.active);
  const base = `/${locale}/roles`;
  const now = requestTime();

  const holders = (list: Holder[], revocable: boolean, roleName: string) =>
    list.length === 0 ? (
      <p className="p-4 text-xs text-muted-foreground">{t("admin.roles.nobody")}</p>
    ) : (
      <ul className="divide-y">
        {list.map((h) => {
          const expired = !!h.expiresAt && h.expiresAt.getTime() <= now;
          return (
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
              {h.expiresAt ? <Badge tone={expired ? "neutral" : "warning"}>{expired ? t("admin.access.roles.expired") : t("admin.access.roles.expiresIn", { time: formatRelativeTime(h.expiresAt, locale) })}</Badge> : null}
              {h.user && !h.user.mfaEnabled ? <Badge tone="danger">{t("admin.roles.noMfa")}</Badge> : null}
              {canManage && revocable ? <RoleRevoke assignmentId={h.assignmentId} who={h.user?.name ?? ""} role={roleName} /> : null}
            </li>
          );
        })}
      </ul>
    );

  return (
    <div className="grid gap-4">
      <AdminHeader
        icon={<ShieldCheck />}
        title={t("admin.nav.roles")}
        description={t("admin.roles.subtitle")}
        why={t("admin.roles.why")}
        actions={
          <>
            {canRoles && matrix ? <CreateRoleButton options={matrix.permissions} held={held} /> : null}
            {canManage ? <RoleGrant roles={grantable} /> : null}
            {canManage ? <BreakGlassButton phrase={BREAK_GLASS_PHRASE} maxMinutes={BREAK_GLASS_MAX_MINUTES} /> : null}
          </>
        }
      />
      <nav aria-label={t("admin.access.roles.sections")} className="flex flex-wrap gap-3 text-xs">
        <SectionLink href={`${base}/matrix`}>
          <Grid3x3 className="size-3" aria-hidden /> {t("admin.access.nav.matrix")}
        </SectionLink>
        <SectionLink href={`${base}/reviews`}>
          <ListChecks className="size-3" aria-hidden /> {t("admin.access.nav.reviews")}
        </SectionLink>
        <SectionLink href={`${base}/impersonation`}>
          <VenetianMask className="size-3" aria-hidden /> {t("admin.access.nav.impersonation")}
        </SectionLink>
        <SectionLink href={`${base}/history`}>
          <History className="size-3" aria-hidden /> {t("admin.access.nav.history")}
        </SectionLink>
        <SectionLink href={`${base}/view-as`}>{t("admin.nav.viewAs")}</SectionLink>
      </nav>
      {activeGlass.map((b) => (
        <Notice key={b.id} tone="danger">
          <span className="inline-flex flex-wrap items-center gap-2">
            <Flame className="size-4" aria-hidden />
            {t("admin.access.roles.breakGlassActive", { who: b.user?.email ?? "—" })}
            {b.expiresAt ? <Timestamp value={b.expiresAt} /> : null}
            <span className="text-xs">“{b.reason}”</span>
          </span>
        </Notice>
      ))}
      <StatGrid>
        <StatTile icon={<Users />} label={t("admin.roles.holders")} value={o.holders} />
        <StatTile icon={<ShieldCheck />} label={t("admin.roles.superAdmins")} value={o.roles.find((x) => x.key === "SUPER_ADMIN")?.holders.length ?? 0} />
        <StatTile icon={<ShieldAlert />} label={t("admin.roles.withoutMfa")} value={o.withoutMfa} tone={o.withoutMfa ? "danger" : "success"} />
        <StatTile icon={<Clock />} label={t("admin.access.roles.temporaryGrants")} value={o.temporary} hint={t("admin.access.roles.customCount", { count: o.custom.length })} />
      </StatGrid>
      {o.withoutMfa ? <Notice tone="danger">{t("admin.roles.withoutMfaHint")}</Notice> : null}

      {o.custom.length ? (
        <>
          <h2 className="text-sm font-semibold">{t("admin.access.roles.customRoles")}</h2>
          <div className="grid gap-4 lg:grid-cols-2">
            {o.custom.map((role) => (
              <Card key={role.id}>
                <CardHeader
                  title={
                    <Link href={`${base}/${role.id}`} className="flex items-center gap-2 hover:underline">
                      {role.name}
                      <Badge className="font-mono">{role.key}</Badge>
                      <Badge tone="info">{t("admin.access.roles.custom")}</Badge>
                    </Link>
                  }
                  description={role.description || undefined}
                  actions={
                    <>
                      <Badge tone="accent">{role.holders.length}</Badge>
                      {canRoles ? <CloneRoleButton source={role.id} sourceName={role.name} locale={locale} /> : null}
                    </>
                  }
                />
                <p className="border-b px-4 py-2 text-xs text-muted-foreground">{t("admin.roles.permissions", { count: role.permissions.length })}</p>
                {holders(role.holders, true, role.name)}
              </Card>
            ))}
          </div>
          <h2 className="text-sm font-semibold">{t("admin.access.roles.builtInRoles")}</h2>
        </>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        {o.roles.map((role) => (
          <Card key={role.key}>
            <CardHeader
              title={
                <Link href={`${base}/${role.key}`} className="flex items-center gap-2 hover:underline">
                  {role.name}
                  <Badge className="font-mono">{role.key}</Badge>
                </Link>
              }
              description={role.description}
              actions={
                <>
                  <Badge tone="accent">{role.holders.length}</Badge>
                  {canRoles && role.grantable ? <CloneRoleButton source={role.key} sourceName={role.name} locale={locale} /> : null}
                </>
              }
            />
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
            {holders(role.holders, role.grantable, role.name)}
          </Card>
        ))}
      </div>
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Eye className="size-3.5" aria-hidden />
        {t("admin.access.roles.enforcedNote")}
      </p>
    </div>
  );
}
