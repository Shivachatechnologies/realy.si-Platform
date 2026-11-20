import Link from "next/link";
import { Fingerprint, KeyRound, MonitorSmartphone, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { AdminHeader, Empty, FilterBar, StatGrid, StatTile, guard, sp } from "@/components/admin/kit";
import { RevokeSession } from "@/components/admin/people-actions";
import { getLocale, getT } from "@/i18n/server";
import { formatRelativeTime } from "@/i18n/format";
import { canPlatform } from "@/server/modules/admin/access";
import { securityHistory } from "@/server/modules/admin/ops";
import { requireViewer } from "@/server/session";

/** Login history (sessions + auth events), permission-change history and session management, per user or platform-wide. */
export default async function AdminSecurityAccessPage({ searchParams }: PageProps<"/[locale]/security/access">) {
  const locale = await getLocale();
  const t = await getT(locale);
  const viewer = await requireViewer(locale);
  const q = await searchParams;
  const params = { user: sp(q.user) };
  const r = await guard(Promise.all([securityHistory(viewer.ctx, params), canPlatform(viewer.ctx, "platform.security.manage")]), t("errors.forbidden"));
  if (!r.ok) return r.node;
  const [o, canManage] = r.value;
  const base = `/${locale}/security/access`;
  const rel = (d: Date) => formatRelativeTime(d, locale);
  return (
    <div className="grid gap-4">
      <AdminHeader icon={<Fingerprint />} title={t("admin.nav.securityAccess")} description={t("admin.securityAccess.subtitle")} why={t("admin.securityAccess.why")} />
      <StatGrid>
        <StatTile icon={<MonitorSmartphone />} label={t("admin.securityAccess.activeSessions")} value={o.activeCount} live />
        <StatTile icon={<ShieldCheck />} label={t("admin.securityAccess.adminSessions")} value={o.sessions.filter((s) => s.admin && s.state === "active").length} />
        <StatTile icon={<KeyRound />} label={t("admin.securityAccess.failedSignIns")} value={o.authEvents.filter((a) => a.action === "auth.sign_in_failed").length} tone={o.authEvents.some((a) => a.action === "auth.sign_in_failed") ? "warning" : undefined} />
        <StatTile label={t("admin.securityAccess.permissionChanges")} value={o.permissionChanges.length} />
      </StatGrid>
      <Card>
        <FilterBar action={base} values={params} filters={[]} submitLabel={t("admin.users.searchButton")} extra={<input name="user" defaultValue={params.user} placeholder={t("admin.securityAccess.userIdFilter")} aria-label={t("admin.securityAccess.userIdFilter")} className="h-9 w-full rounded-md border bg-surface px-2.5 font-mono text-xs sm:w-80" />} />
        <CardHeader icon={<MonitorSmartphone />} title={t("admin.securityAccess.sessions")} description={t("admin.securityAccess.sessionsHint")} />
        {o.sessions.length === 0 ? (
          <Empty>{t("admin.roles.viewAs.none")}</Empty>
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>{t("admin.people.name")}</Th>
                <Th>{t("admin.securityAccess.device")}</Th>
                <Th>{t("admin.securityAccess.started")}</Th>
                <Th>{t("admin.securityAccess.lastSeen")}</Th>
                <Th>{t("admin.users.columns.status")}</Th>
                <Th className="text-end">{t("admin.common.actions")}</Th>
              </Tr>
            </THead>
            <TBody>
              {o.sessions.map((s) => (
                <Tr key={s.id}>
                  <Td>
                    <Link href={`${base}?user=${s.userId}`} className="font-medium hover:underline">
                      {s.user.name}
                    </Link>{" "}
                    {s.admin ? <Badge tone="accent">{t("admin.securityAccess.admin")}</Badge> : null}
                    <div className="text-[11px] text-muted-foreground">{s.user.email}</div>
                  </Td>
                  <Td className="max-w-56 text-[11px]">
                    <span className="font-mono">{s.ip ?? "—"}</span>
                    <div className="truncate text-muted-foreground">{s.userAgent ?? "—"}</div>
                  </Td>
                  <Td className="text-xs text-muted-foreground">{rel(s.createdAt)}</Td>
                  <Td className="text-xs text-muted-foreground">{rel(s.lastSeenAt)}</Td>
                  <Td>
                    <Badge tone={s.state === "active" ? "success" : "neutral"}>{t(`admin.securityAccess.state.${s.state}`)}</Badge>
                    {s.mfaVerifiedAt ? <div className="text-[11px] text-muted-foreground">MFA · {rel(s.mfaVerifiedAt)}</div> : null}
                  </Td>
                  <Td className="text-end">{canManage && s.state === "active" && s.id !== viewer.ctx.sessionId ? <RevokeSession sessionId={s.id} /> : null}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader icon={<KeyRound />} title={t("admin.securityAccess.loginEvents")} />
          {o.authEvents.length === 0 ? (
            <Empty>{t("admin.roles.viewAs.none")}</Empty>
          ) : (
            <ul className="divide-y text-xs">
              {o.authEvents.map((a) => (
                <li key={a.id} className="flex justify-between gap-2 px-4 py-1.5">
                  <span>
                    <span className={`font-mono ${a.action === "auth.sign_in_failed" ? "text-danger" : ""}`}>{a.action}</span> <span className="text-muted-foreground">· {a.who}</span>
                  </span>
                  <span className="text-muted-foreground">{rel(a.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardHeader icon={<ShieldCheck />} title={t("admin.securityAccess.permissionChanges")} description={t("admin.securityAccess.permissionChangesHint")} />
          {o.permissionChanges.length === 0 ? (
            <Empty>{t("admin.roles.viewAs.none")}</Empty>
          ) : (
            <ul className="divide-y text-xs">
              {o.permissionChanges.map((p) => {
                const role = (p.newValue as { roleKey?: string } | null)?.roleKey ?? (p.oldValue as { roleKey?: string } | null)?.roleKey;
                return (
                  <li key={p.id} className="grid gap-0.5 px-4 py-1.5">
                    <div className="flex justify-between gap-2">
                      <span>
                        <span className="font-mono">{p.action}</span> {role ? <Badge className="font-mono">{role}</Badge> : null}
                      </span>
                      <span className="text-muted-foreground">{rel(p.createdAt)}</span>
                    </div>
                    <div className="text-muted-foreground">
                      {p.who} → {p.target}
                      {p.reason ? ` · “${p.reason}”` : ""}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
