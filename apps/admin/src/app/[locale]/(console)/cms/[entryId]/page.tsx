import Link from "next/link";
import { ExternalLink, FileText } from "lucide-react";
import { AdminHeader, guard } from "@/components/admin/kit";
import { CmsEditor } from "@/components/admin/cms-editor";
import { getLocale, getT } from "@/i18n/server";
import { canPlatform } from "@/server/modules/admin/access";
import { listMedia } from "@/server/modules/cms/media";
import { getEntry } from "@/server/modules/cms/service";
import { requireViewer } from "@/server/session";

/** Page / post / landing editor: structured blocks per locale with live preview, SEO, publishing and versions. */
export default async function AdminCmsEntryPage({ params }: PageProps<"/[locale]/cms/[entryId]">) {
  const locale = await getLocale();
  const t = await getT(locale);
  const viewer = await requireViewer(locale);
  const { entryId } = await params;
  const r = await guard(Promise.all([getEntry(viewer.ctx, entryId), listMedia(viewer.ctx), canPlatform(viewer.ctx, "platform.content.manage")]), t("errors.forbidden"));
  if (!r.ok) return r.node;
  const [e, media, canManage] = r.value;
  const publicBase = process.env.USER_APP_URL ?? null;
  const dto = {
    ...e,
    publishAt: e.publishAt?.toISOString() ?? null,
    publishedAt: e.publishedAt?.toISOString() ?? null,
    updatedAt: e.updatedAt.toISOString(),
    versions: e.versions.map((v) => ({ id: v.id, version: v.version, note: v.note, createdBy: v.createdBy, createdAt: v.createdAt.toISOString() })),
  };
  return (
    <div className="grid gap-4">
      <AdminHeader
        icon={<FileText />}
        eyebrow={
          <Link href={`/${locale}/cms`} className="hover:underline">
            {t("admin.nav.cms")}
          </Link>
        }
        title={e.draft.locales["en-US"]?.title || e.slug}
        description={t(`admin.cms.kinds.${e.kind}`)}
        actions={
          e.hasPublished && publicBase ? (
            <a href={`${publicBase}/${locale}/pages/${e.slug}`} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
              {t("admin.cms.viewLive")}
              <ExternalLink className="size-3" aria-hidden />
            </a>
          ) : null
        }
      />
      <CmsEditor
        key={`${dto.status}-${dto.liveVersion}-${dto.versions.length}`}
        entry={dto}
        media={media.items.map((m) => ({ ref: m.ref, fileName: m.fileName, url: m.url }))}
        canManage={canManage}
        publicBase={publicBase}
      />
    </div>
  );
}
