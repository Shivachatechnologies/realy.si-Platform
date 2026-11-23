import Link from "next/link";
import { Fingerprint, MonitorSmartphone, ShieldAlert, ShieldCheck, UserCog } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { LiveDot } from "@/components/motion/live-dot";
import { AdminHeader, AuditTimeline, Avatar, EmptyState, SectionLink, guard } from "@/components/admin/kit";
import { BarList, Gauge } from "@/components/admin/viz";
import { getLocale, getT } from "@/i18n/server";
import { formatDateTime, formatNumber, formatRelativeTime } from "@/i18n/format";
import { securityOverview } from "@/server/modules/admin/security";
import { requestTime, requireViewer } from "@/server/session";

/** Security: event volume by action, administrator MFA coverage, admin sessions and the security event timeline. */
export default async function AdminSecurityPage() {
  const locale = await getLocale();
  const t = await getT(locale);
  const viewer = await requireViewer(locale);
  const r = await guard(securityOverview(viewer.ctx), t("errors.forbidden"));
  if (!r.ok) return r.node;
  const s = r.value;
  const tz = viewer.user.timezone;
  const now = requestTime();
  const base = `/${locale}`;
  const mfaOn = s.admins.filter((a) => a.mfaEnabled).length;
  const verifiedSessions = s.adminSessions.filter((x) => x.mfaVerifiedAt).length;
  return (
    <div className="grid gap-5">
      <AdminHeader
        icon={<ShieldCheck />}
        title={t("admin.nav.security")}
        description={t("admin.security.subtitle")}
        why={t("admin.security.why")}
        actions={
          <>
            <SectionLink href={`${base}/security/posture`}>{t("admin.security.posture.title")}</SectionLink>
            <SectionLink href={`${base}/audit?category=SECURITY&scope=all`}>{t("admin.nav.audit")}</SectionLink>
          </>
        }
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader icon={<Fingerprint />} title={t("admin.security.mfaCoverage")} description={t("admin.security.mfaCoverageHint")} />
          <CardBody className="grid grid-cols-2 gap-3">
            <Gauge
              label={t("admin.security.admins")}
              value={mfaOn}
              max={Math.max(1, s.admins.length)}
              tone={mfaOn === s.admins.length ? "success" : "danger"}
              display={`${formatNumber(mfaOn, locale)}/${formatNumber(s.admins.length, locale)}`}
              sub={t("admin.users.mfaOn")}
            />
            <Gauge
              label={t("admin.security.adminSessions")}
              value={verifiedSessions}
              max={Math.max(1, s.adminSessions.length)}
              tone={verifiedSessions === s.adminSessions.length ? "success" : "warning"}
              display={`${formatNumber(verifiedSessions, locale)}/${formatNumber(s.adminSessions.length, locale)}`}
              sub={t("admin.security.verified")}
            />
          </CardBody>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader icon={<ShieldAlert />} title={t("admin.security.byAction")} description={t("admin.overview.last30")} />
          <CardBody>
            <BarList
              label={t("admin.security.byAction")}
              tone="warning"
              items={s.byAction.slice(0, 10).map((a) => ({
                key: a.action,
                label: <span className="font-mono text-xs">{a.action}</span>,
                value: a.count,
                tone: s.highlighted.includes(a.action) ? "danger" : "warning",
                href: `${base}/audit?category=SECURITY&action=${encodeURIComponent(a.action)}&scope=all`,
              }))}
              empty={<EmptyState icon={<ShieldCheck />} title={t("admin.audit.empty")} body={t("admin.security.quietHint")} />}
            />
          </CardBody>
        </Card>
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader icon={<UserCog />} title={t("admin.security.admins")} />
          <ul className="divide-y">
            {s.admins.map((a) => (
              <li key={a.id} className="flex items-center gap-3 px-4 py-2.5">
                <Avatar name={a.name || a.email} size="sm" />
                <div className="min-w-0 flex-1">
                  <Link href={`${base}/users/${a.id}`} className="truncate text-sm font-medium hover:underline">
                    {a.name}
                  </Link>
                  <div className="truncate font-mono text-[11px] text-muted-foreground">{a.roles.join(", ")}</div>
                </div>
                <Badge shape="pill" tone={a.mfaEnabled ? "success" : "danger"}>
                  {a.mfaEnabled ? t("admin.users.mfaOn") : t("admin.users.mfaOff")}
                </Badge>
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <CardHeader icon={<MonitorSmartphone />} title={t("admin.security.adminSessions")} />
          {s.adminSessions.length === 0 ? (
            <EmptyState icon={<MonitorSmartphone />} title={t("admin.security.noSessions")} />
          ) : (
            <ul className="divide-y">
              {s.adminSessions.map((x) => (
                <li key={x.id} className="flex items-center gap-3 px-4 py-2.5 text-xs">
                  <LiveDot tone={x.mfaVerifiedAt ? "success" : "warning"} pulse={now - x.lastSeenAt.getTime() < 5 * 60_000} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm">{x.email}</div>
                    <div className="truncate font-mono text-[11px] text-muted-foreground">{x.ip ?? "—"}</div>
                  </div>
                  <span className="text-muted-foreground">{formatRelativeTime(x.lastSeenAt, locale, now)}</span>
                  <Badge tone={x.mfaVerifiedAt ? "success" : "warning"}>{x.mfaVerifiedAt ? t("admin.security.verified") : t("admin.security.notVerified")}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      <Card>
        <CardHeader icon={<ShieldAlert />} title={t("admin.security.events")} />
        {s.events.length === 0 ? (
          <EmptyState icon={<ShieldCheck />} title={t("admin.audit.empty")} body={t("admin.security.quietHint")} />
        ) : (
          <AuditTimeline
            items={s.events.map((e) => ({
              id: e.id,
              who: e.actorEmail ?? e.actorType,
              action: e.action,
              security: true,
              reason: e.reason,
              iso: e.createdAt.toISOString(),
              exact: formatDateTime(e.createdAt, locale, tz),
              relative: formatRelativeTime(e.createdAt, locale, now),
              extra: (
                <>
                  {s.highlighted.includes(e.action) ? <Badge tone="danger">{t("admin.security.important")}</Badge> : null}
                  {e.ip ? <span className="font-mono text-[11px] text-muted-foreground">{e.ip}</span> : null}
                </>
              ),
            }))}
          />
        )}
      </Card>
    </div>
  );
}
