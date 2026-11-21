import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, History } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { sitesPage } from "@/components/sites/context";
import { BlockEditor } from "@/components/sites/block-editor";
import { RollbackButtons } from "@/components/sites/site-actions";
import { getT } from "@/i18n/server";
import { formatDateTime } from "@/i18n/format";
import { isAppError } from "@/server/core/errors";
import { assetFileUrl } from "@/server/modules/assets/presets";
import { hasFeature } from "@/server/modules/entitlements/service";
import { editorData, getPage } from "@/server/modules/sites/service";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: `${t("sites.editor.title")} · ${t("sites.title")}` };
}

/** /website/pages/[pageId] — visual block editor with live preview, publish / schedule, versions and rollback. */
export default async function SitePageEditor({ params }: PageProps<"/[locale]/website/pages/[pageId]">) {
  const { pageId } = await params;
  const p = await sitesPage(null, { header: false });
  if (p.gate) return p.gate;
  const { org, company, viewer, locale, t, perms, base, site, tz } = p;
  if (!site) redirect(`/${locale}/website`);
  const page = await getPage(viewer.ctx, org.id, company.id, pageId).catch((err) => {
    if (isAppError(err) && err.code === "not_found") notFound();
    throw err;
  });
  const [refs, entitled] = await Promise.all([editorData(viewer.ctx, org.id, company.id), hasFeature(org.id, "feature.website_builder")]);
  return (
    <div className="mx-auto grid w-full max-w-[1600px] gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Link href={`/${locale}/website/pages`} className="flex min-h-10 items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4 rtl:rotate-180" aria-hidden />
          {t("sites.tabs.pages")}
        </Link>
        <h1 className="font-display text-2xl">{page.title}</h1>
        <span className="font-mono text-xs text-muted-foreground">/s/{site.slug}/{page.slug}</span>
      </div>
      <BlockEditor
        base={base}
        page={{ id: page.id, kind: page.kind, slug: page.slug, status: page.status, showInNav: page.showInNav, aiDrafted: page.aiDrafted, draft: page.draft, hasPublished: page.hasPublished, hasUnpublished: page.hasUnpublished, updatedAt: page.updatedAt.toISOString() }}
        site={{ slug: site.slug, name: site.name, theme: site.theme, nav: site.nav, footer: site.footer, online: site.online }}
        refs={{ assets: refs.assets.map((a) => ({ id: a.id, title: a.title, url: assetFileUrl(org.id, company.id, a.id) })), customers: refs.customers, products: refs.products }}
        canManage={perms.manage}
        canPublish={perms.manage && entitled}
      />
      <Card>
        <CardHeader icon={<History />} title={t("sites.versions.title")} description={t("sites.versions.hint")} />
        <CardBody className="p-0">
          {page.versions.length ? (
            <ul className="divide-y">
              {page.versions.map((v) => (
                <li key={v.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
                  <span className="font-medium">v{v.version}</span>
                  {page.liveVersion === v.version ? <span className="rounded bg-success/10 px-1.5 text-xs text-success">{t("sites.versions.live")}</span> : null}
                  <span className="text-xs text-muted-foreground">
                    {formatDateTime(v.createdAt, locale, tz)}
                    {v.createdBy ? ` · ${v.createdBy}` : ""}
                    {v.note ? ` · ${v.note}` : ""}
                  </span>
                  <div className="ms-auto">
                    <RollbackButtons base={base} pageId={page.id} version={v.version} canManage={perms.manage} />
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="p-4 text-sm text-muted-foreground">{t("sites.versions.empty")}</p>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
