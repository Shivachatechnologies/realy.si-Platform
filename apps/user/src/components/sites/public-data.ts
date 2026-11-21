import "server-only";
import { cache } from "react";
import { unstable_cache } from "next/cache";
import type { Translate } from "@/i18n/translate";
import { loadPublicPage, loadPublicSite, publicAssetUrl, siteCacheTag, type PublicSite } from "@/server/modules/sites/public";
import type { ContactFormLabels } from "./contact-form";
import type { SiteRenderContext } from "./blocks";

/**
 * Cached public site data (Next data cache, 60 s, tag `site:<slug>` expired on publish / settings changes). HTML is
 * still rendered per request (the per-request CSP nonce, see next.config.ts), from cached data.
 */
const REVALIDATE = 60;

export const getPublicSite = cache((slug: string) => unstable_cache(() => loadPublicSite(slug), ["public-site", slug], { revalidate: REVALIDATE, tags: [siteCacheTag(slug)] })());
export const getPublicPage = cache((slug: string, path: string) => unstable_cache(() => loadPublicPage(slug, path), ["public-site-page", slug, path], { revalidate: REVALIDATE, tags: [siteCacheTag(slug)] })());

export function formLabels(t: Translate): ContactFormLabels {
  const k = (s: string) => t(`sites.public.form.${s}`);
  return { name: k("name"), email: k("email"), phone: k("phone"), company: k("company"), message: k("message"), send: k("send"), sending: k("sending"), success: k("success"), error: k("error"), rateLimited: k("rateLimited"), required: k("required"), invalidEmail: k("invalidEmail"), consentDefault: k("consentDefault") };
}

export const chromeLabels = (t: Translate): SiteRenderContext["labels"] => ({ menu: t("sites.public.menu"), poweredBy: t("sites.public.poweredBy"), contactUs: t("sites.public.contactUs"), customerOf: t("sites.public.customerOf") });

export const siteAssetUrl = (site: Pick<PublicSite, "slug">) => (id: string) => publicAssetUrl(site.slug, id);
