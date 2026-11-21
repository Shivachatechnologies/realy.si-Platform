import { env } from "@/server/core/env";
import { loadPublicSite } from "@/server/modules/sites/public";
import { sitePath } from "@/server/modules/sites/schemas";

/**
 * robots.txt of one company website. Crawlers read robots.txt at a host's root, so this file takes effect once the
 * site is served on its own (verified) domain (docs/sites.md); on app.realy.si the platform robots.txt applies.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ siteSlug: string }> }) {
  const { siteSlug } = await params;
  const site = await loadPublicSite(siteSlug);
  if (!site) return new Response("Not found", { status: 404 });
  const origin = env().APP_URL.replace(/\/$/, "");
  const body = site.seo.noIndex ? "User-agent: *\nDisallow: /\n" : `User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: ${origin}${sitePath(site.slug)}/sitemap.xml\n`;
  return new Response(body, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=3600" } });
}
