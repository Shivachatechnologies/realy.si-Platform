import { Megaphone, PanelTop } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { AdminHeader, Empty, guard } from "@/components/admin/kit";
import { AnnouncementComposer, BannerEditor } from "@/components/admin/platform-actions";
import { getLocale, getT } from "@/i18n/server";
import { formatNumber, formatRelativeTime } from "@/i18n/format";
import { canPlatform } from "@/server/modules/admin/access";
import { announcementsOverview } from "@/server/modules/admin/announcements";
import { requireViewer } from "@/server/session";

/** Platform announcements (in-app notifications to all / selected organizations) and the site-wide banner. */
export default async function AdminAnnouncementsPage() {
  const locale = await getLocale();
  const t = await getT(locale);
  const viewer = await requireViewer(locale);
  const r = await guard(Promise.all([announcementsOverview(viewer.ctx), canPlatform(viewer.ctx, "platform.controls.manage")]), t("errors.forbidden"));
  if (!r.ok) return r.node;
  const [o, canManage] = r.value;
  return (
    <div className="grid gap-4">
      <AdminHeader icon={<Megaphone />} title={t("admin.nav.announcements")} description={t("admin.announcements.subtitle")} why={t("admin.announcements.why")} />
      <div className="grid gap-4 xl:grid-cols-2">
        {canManage ? <AnnouncementComposer activeOrganizations={o.activeOrganizations} /> : null}
        <Card>
          <CardHeader
            icon={<PanelTop />}
            title={t("admin.announcements.banner")}
            description={t("admin.announcements.bannerHint")}
            actions={o.banner.active ? <Badge tone={o.banner.tone === "danger" ? "danger" : o.banner.tone === "warning" ? "warning" : "info"}>{t("admin.announcements.bannerLive")}</Badge> : <Badge>{t("admin.announcements.bannerOff")}</Badge>}
          />
          {canManage ? <BannerEditor banner={{ ...o.banner, endsAt: o.banner.endsAt }} /> : <p className="p-4 text-sm">{o.banner.message || "—"}</p>}
        </Card>
      </div>
      <Card>
        <CardHeader icon={<Megaphone />} title={t("admin.announcements.history")} />
        {o.history.length === 0 ? (
          <Empty>{t("admin.announcements.noHistory")}</Empty>
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>{t("admin.announcements.title")}</Th>
                <Th>{t("admin.announcements.audience")}</Th>
                <Th>{t("admin.announcements.recipients")}</Th>
                <Th>{t("admin.announcements.sentBy")}</Th>
              </Tr>
            </THead>
            <TBody>
              {o.history.map((h) => (
                <Tr key={h.id}>
                  <Td>
                    <div className="font-medium">{h.title}</div>
                    {h.body ? <div className="line-clamp-1 text-xs text-muted-foreground">{h.body}</div> : null}
                    <div className="font-mono text-[11px] text-muted-foreground">{h.href}</div>
                  </Td>
                  <Td className="text-xs">{h.audience === "all" ? t("admin.announcements.allShort") : t("admin.announcements.orgs", { count: h.orgCount })}</Td>
                  <Td className="tabular-nums">{formatNumber(h.recipients, locale)}</Td>
                  <Td className="text-xs text-muted-foreground">
                    {h.author} · {formatRelativeTime(h.createdAt, locale)}
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
