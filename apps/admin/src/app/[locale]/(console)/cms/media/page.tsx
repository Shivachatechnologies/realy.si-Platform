import { Database, HardDrive, Image as ImageIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { AdminHeader, EmptyState, guard } from "@/components/admin/kit";
import { MediaDelete, MediaTargetPicker, MediaUpload } from "@/components/admin/cms-actions";
import { getLocale, getT } from "@/i18n/server";
import { formatNumber, formatRelativeTime } from "@/i18n/format";
import { canPlatform } from "@/server/modules/admin/access";
import { listMedia } from "@/server/modules/cms/media";
import { requireViewer } from "@/server/session";

/** Website media library, stored through the integrations storage service of the platform's media company. */
export default async function AdminCmsMediaPage() {
  const locale = await getLocale();
  const t = await getT(locale);
  const viewer = await requireViewer(locale);
  const r = await guard(Promise.all([listMedia(viewer.ctx), canPlatform(viewer.ctx, "platform.content.manage")]), t("errors.forbidden"));
  if (!r.ok) return r.node;
  const [o, canManage] = r.value;
  return (
    <div className="grid gap-4">
      <AdminHeader icon={<ImageIcon />} title={t("admin.nav.media")} description={t("admin.cms.media.subtitle")} why={t("admin.cms.media.why")} actions={canManage && o.target ? <MediaUpload /> : null} />
      <Card>
        <CardHeader
          icon={o.backend === "s3" ? <HardDrive /> : <Database />}
          title={t("admin.cms.media.storage")}
          description={o.target ? t("admin.cms.media.storedIn", { company: o.target.companyName, organization: o.target.organizationName }) : t("admin.cms.media.noTarget")}
          actions={canManage ? <MediaTargetPicker current={o.target?.companyId ?? null} /> : null}
        />
        <CardBody>
          {!o.target ? (
            <Notice tone="warning">{t("admin.cms.media.noTargetHint")}</Notice>
          ) : o.backend === "s3" ? (
            <Badge tone="success">{t("admin.cms.media.s3")}</Badge>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="warning">{t("admin.cms.media.dbFallback")}</Badge>
              <span className="text-xs text-muted-foreground">{t("admin.cms.media.dbFallbackHint")}</span>
            </div>
          )}
        </CardBody>
      </Card>
      <Card>
        <CardHeader icon={<ImageIcon />} title={t("admin.cms.media.library")} description={t("admin.cms.media.count", { count: o.items.length })} />
        {o.items.length === 0 ? (
          <EmptyState icon={<ImageIcon />} title={t("admin.cms.media.empty")} body={t("admin.cms.media.emptyHint")} />
        ) : (
          <ul className="grid grid-cols-2 gap-3 p-3 sm:grid-cols-3 xl:grid-cols-5">
            {o.items.map((m) => (
              <li key={m.id} className="overflow-hidden rounded-md border bg-surface-2">
                <div className="grid aspect-video place-items-center bg-muted">
                  {m.url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={m.url} alt={m.alt} className="size-full object-cover" loading="lazy" />
                  ) : (
                    <ImageIcon className="size-5 text-muted-foreground" aria-hidden />
                  )}
                </div>
                <div className="flex items-start gap-1 p-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-medium">{m.fileName}</div>
                    <div className="font-mono text-[10px] text-muted-foreground">
                      {formatNumber(Math.round(m.size / 1024), locale)} KB · {m.backend} · {formatRelativeTime(m.createdAt, locale)}
                    </div>
                    <div className="truncate font-mono text-[10px] text-muted-foreground">{m.ref}</div>
                  </div>
                  {canManage ? <MediaDelete id={m.id} name={m.fileName} /> : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
