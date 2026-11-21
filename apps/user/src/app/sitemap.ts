import type { MetadataRoute } from "next";
import { LOCALES } from "@/i18n/config";
import { env } from "@/server/core/env";
import { BLOG_POSTS, sitePaths } from "@/server/modules/site/content";

/** Public website sitemap: every marketing page in all five locales, with hreflang alternates. */
export default function sitemap(): MetadataRoute.Sitemap {
  const origin = env().APP_URL.replace(/\/$/, "");
  const posted = new Map<string, string>(BLOG_POSTS.map((p) => [`/blog/posts/${p.slug}`, p.publishedAt]));
  return sitePaths().flatMap((path) =>
    LOCALES.map((locale) => ({
      url: `${origin}/${locale}${path}`,
      ...(posted.has(path) ? { lastModified: new Date(posted.get(path)!) } : {}),
      changeFrequency: path.startsWith("/blog") ? ("weekly" as const) : ("monthly" as const),
      priority: path === "" ? 1 : path.split("/").length > 2 ? 0.6 : 0.8,
      alternates: { languages: Object.fromEntries(LOCALES.map((l) => [l, `${origin}/${l}${path}`])) },
    })),
  );
}
