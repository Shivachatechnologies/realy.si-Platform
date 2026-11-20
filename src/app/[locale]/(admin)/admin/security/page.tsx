import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { AdminHeader, Empty, guard } from "@/components/admin/kit";
import { getLocale, getT } from "@/i18n/server";
import { formatDateTime, formatNumber, formatRelativeTime } from "@/i18n/format";
import { securityOverview } from "@/server/modules/admin/security";
import { requestTime, requireViewer } from "@/server/session";

/** Security events, platform administrators (MFA state, roles) and their active sessions. */
export default async function AdminSecurityPage() {
  const locale = await getLocale();
  const t = await getT(locale);
  const viewer = await requireViewer(locale);
  const r = await guard(securityOverview(viewer.ctx), t("errors.forbidden"));
  if (!r.ok) return r.node;
  const s = r.value;
  const tz = viewer.user.timezone;
  const now = requestTime();
  const base = `/${locale}/admin`;
  return (
    <div className="grid gap-4">
      <AdminHeader title={t("admin.nav.security")} description={t("admin.security.subtitle")} />
      <Card>
        <CardHeader title={t("admin.security.byAction")} description={t("admin.overview.last30")} />
        {s.byAction.length === 0 ? (
          <Empty>{t("admin.audit.empty")}</Empty>
        ) : (
          <div className="flex flex-wrap gap-2 p-3">
            {s.byAction.map((a) => (
              <Link key={a.action} href={`${base}/audit?category=SECURITY&action=${encodeURIComponent(a.action)}&scope=all`} className="rounded-md border px-2 py-1 text-xs hover:bg-muted">
                <span className="font-mono">{a.action}</span> <span className="tabular font-medium">{formatNumber(a.count, locale)}</span>
              </Link>
            ))}
          </div>
        )}
      </Card>
      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title={t("admin.security.admins")} />
          <Table>
            <THead>
              <Tr>
                <Th>{t("admin.users.columns.user")}</Th>
                <Th>{t("admin.users.detail.roles")}</Th>
                <Th>{t("admin.users.columns.security")}</Th>
              </Tr>
            </THead>
            <TBody>
              {s.admins.map((a) => (
                <Tr key={a.id}>
                  <Td>
                    <Link href={`${base}/users/${a.id}`} className="hover:underline">
                      {a.name}
                    </Link>
                    <div className="text-xs text-muted-foreground">{a.email}</div>
                  </Td>
                  <Td className="font-mono text-[11px]">{a.roles.join(", ")}</Td>
                  <Td>
                    <Badge tone={a.mfaEnabled ? "success" : "danger"}>{a.mfaEnabled ? t("admin.users.mfaOn") : t("admin.users.mfaOff")}</Badge>
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        </Card>
        <Card>
          <CardHeader title={t("admin.security.adminSessions")} />
          {s.adminSessions.length === 0 ? (
            <Empty>{t("admin.security.noSessions")}</Empty>
          ) : (
            <Table>
              <THead>
                <Tr>
                  <Th>{t("admin.users.columns.user")}</Th>
                  <Th>IP</Th>
                  <Th>{t("admin.users.detail.lastSeen")}</Th>
                  <Th>MFA</Th>
                </Tr>
              </THead>
              <TBody>
                {s.adminSessions.map((x) => (
                  <Tr key={x.id}>
                    <Td className="text-xs">{x.email}</Td>
                    <Td className="font-mono text-[11px]">{x.ip ?? "—"}</Td>
                    <Td className="text-xs whitespace-nowrap">{formatRelativeTime(x.lastSeenAt, locale, now)}</Td>
                    <Td>
                      <Badge tone={x.mfaVerifiedAt ? "success" : "warning"}>{x.mfaVerifiedAt ? t("admin.security.verified") : t("admin.security.notVerified")}</Badge>
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          )}
        </Card>
      </div>
      <Card>
        <CardHeader title={t("admin.security.events")} />
        {s.events.length === 0 ? (
          <Empty>{t("admin.audit.empty")}</Empty>
        ) : (
          <ul className="divide-y">
            {s.events.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center gap-2 px-4 py-2 text-xs">
                <span className="text-muted-foreground">{formatDateTime(e.createdAt, locale, tz)}</span>
                <Badge tone={s.highlighted.includes(e.action) ? "danger" : "warning"}>{e.action}</Badge>
                <span>{e.actorEmail ?? e.actorType}</span>
                {e.ip ? <span className="font-mono text-[11px] text-muted-foreground">{e.ip}</span> : null}
                {e.reason ? <span className="min-w-0 truncate">{e.reason}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
