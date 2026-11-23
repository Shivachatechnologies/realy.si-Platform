import Link from "next/link";
import { Bell, Building2, Eye, History } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { AdminHeader, Empty, Facts, guard, sp } from "@/components/admin/kit";
import { ViewAsForm } from "@/components/admin/people/role-actions";
import { getLocale, getT } from "@/i18n/server";
import { formatDate, formatRelativeTime } from "@/i18n/format";
import { viewAsSummary } from "@/server/modules/admin/roles";
import { requireViewer } from "@/server/session";

/** Support "view as": a read-only summary of what one user sees. No session impersonation; every view audited. */
export default async function AdminViewAsPage({ searchParams }: PageProps<"/[locale]/roles/view-as">) {
  const locale = await getLocale();
  const t = await getT(locale);
  const viewer = await requireViewer(locale);
  const q = await searchParams;
  const userId = sp(q.user);
  const reason = sp(q.reason);
  const r = userId && reason ? await guard(viewAsSummary(viewer.ctx, userId, { reason }), t("errors.forbidden")) : null;
  if (r && !r.ok) return r.node;
  const s = r?.value;
  return (
    <div className="grid gap-4">
      <AdminHeader icon={<Eye />} title={t("admin.nav.viewAs")} description={t("admin.roles.viewAs.subtitle")} why={t("admin.roles.viewAs.why")} />
      <Card>
        <ViewAsForm initialUserId={userId} />
      </Card>
      {s ? (
        <>
          <Notice tone="info">{t("admin.roles.viewAs.readOnly", { name: s.user.name })}</Notice>
          <Card>
            <CardHeader title={s.user.name} description={s.user.email} actions={<Badge tone={s.user.status === "ACTIVE" ? "success" : "warning"}>{s.user.status}</Badge>} />
            <Facts
              rows={[
                [t("admin.roles.viewAs.locale"), `${s.user.locale} · ${s.user.timezone}`],
                [t("admin.roles.viewAs.mfa"), s.user.mfaEnabled ? t("admin.roles.viewAs.on") : t("admin.roles.viewAs.off")],
                [t("admin.roles.viewAs.sessions"), String(s.sessions)],
                [t("admin.roles.viewAs.unread"), String(s.unread)],
                [t("admin.roles.viewAs.aiTasks"), String(s.aiTasksMonth)],
                [t("admin.roles.viewAs.since"), formatDate(s.user.createdAt, locale, viewer.user.timezone)],
                [t("admin.roles.viewAs.platformRoles"), s.platformRoles.join(", ") || "—"],
              ]}
            />
          </Card>
          <Card>
            <CardHeader icon={<Building2 />} title={t("admin.roles.viewAs.organizations")} />
            {s.organizations.length === 0 ? (
              <Empty>{t("admin.roles.viewAs.noOrgs")}</Empty>
            ) : (
              <ul className="divide-y">
                {s.organizations.map((o) => (
                  <li key={o.id} className="grid gap-1 px-4 py-2 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link href={`/${locale}/organizations/${o.id}`} className="font-medium hover:underline">
                        {o.name}
                      </Link>
                      <Badge>{o.membership}</Badge>
                      {o.roles.map((x) => (
                        <Badge key={x} tone="accent" className="font-mono">
                          {x}
                        </Badge>
                      ))}
                    </div>
                    <div className="text-xs text-muted-foreground">{o.companies.map((c) => c.name).join(" · ") || "—"}</div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader icon={<Bell />} title={t("admin.roles.viewAs.notifications")} />
              {s.notifications.length === 0 ? (
                <Empty>{t("admin.roles.viewAs.none")}</Empty>
              ) : (
                <ul className="divide-y text-xs">
                  {s.notifications.map((n) => (
                    <li key={n.id} className="flex justify-between gap-2 px-4 py-1.5">
                      <span className="font-mono">{n.type}</span>
                      <span className="text-muted-foreground">
                        {n.readAt ? "" : "● "}
                        {formatRelativeTime(n.createdAt, locale)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card>
              <CardHeader icon={<History />} title={t("admin.roles.viewAs.activity")} />
              {s.activity.length === 0 ? (
                <Empty>{t("admin.roles.viewAs.none")}</Empty>
              ) : (
                <ul className="divide-y text-xs">
                  {s.activity.map((a) => (
                    <li key={a.id} className="flex justify-between gap-2 px-4 py-1.5">
                      <span className="font-mono">{a.action}</span>
                      <span className="text-muted-foreground">{formatRelativeTime(a.createdAt, locale)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </>
      ) : null}
    </div>
  );
}
