import { env } from "@/server/core/env";
import { loadPublicSite } from "@/server/modules/sites/public";
import { sitePath } from "@/server/modules/sites/schemas";

const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Sitemap of one published company website (/s/<slug>/sitemap.xml): live, indexable pages only. */
export async function GET(_req: Request, { params }: { params: Promise<{ siteSlug: string }> }) {
  const { siteSlug } = await params;
  const site = await loadPublicSite(siteSlug);
  if (!site) return new Response("Not found", { status: 404 });
  const origin = env().APP_URL.replace(/\/$/, "");
  const urls = site.seo.noIndex
    ? []
    : site.pages
        .filter((p) => !p.noIndex)
        .map((p) => `  <url><loc>${xml(`${origin}${sitePath(site.slug, p.slug)}`)}</loc>${p.publishedAt ? `<lastmod>${p.publishedAt}</lastmod>` : ""}<priority>${p.slug ? "0.7" : "1.0"}</priority></url>`);
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`;
  return new Response(body, { headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=600" } });
}
