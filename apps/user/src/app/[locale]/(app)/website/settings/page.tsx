import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { sitesPage } from "@/components/sites/context";
import { SiteSettingsForm } from "@/components/sites/settings-form";
import { getT } from "@/i18n/server";
import { db } from "@/server/core/db";
import { assetFileUrl } from "@/server/modules/assets/presets";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: `${t("sites.tabs.settings")} · ${t("sites.title")}` };
}

/** /website/settings — name, address, language, theme (brand colour, font, logo), navigation, footer, SEO. */
export default async function SiteSettingsPage() {
  const p = await sitesPage("settings");
  if (p.gate) return p.gate;
  const { org, company, locale, perms, base, site, wrap } = p;
  if (!site) redirect(`/${locale}/website`);
  const [assets, pages] = await Promise.all([
    db().visualAsset.findMany({ where: { organizationId: org.id, companyId: company.id, kind: { in: ["IMAGE", "SVG"] } }, orderBy: [{ pinned: "desc" }, { createdAt: "desc" }], take: 40, select: { id: true, title: true } }),
    db().sitePage.findMany({ where: { siteId: site.id, kind: "PAGE" }, orderBy: [{ position: "asc" }], take: 30, select: { slug: true, title: true } }),
  ]);
  return wrap(
    <SiteSettingsForm
      base={base}
      site={{ name: site.name, slug: site.slug, locale: site.locale, theme: site.theme, nav: site.nav, footer: site.footer, seo: site.seo }}
      logos={assets.map((a) => ({ id: a.id, title: a.title, url: assetFileUrl(org.id, company.id, a.id) }))}
      pages={pages}
      canManage={perms.manage}
    />,
  );
}
