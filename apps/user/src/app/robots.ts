import type { MetadataRoute } from "next";
import { env } from "@/server/core/env";

/** Crawl the public website; keep the API, the signed-in app's private areas and token links out of the index. */
export default function robots(): MetadataRoute.Robots {
  const origin = env().APP_URL.replace(/\/$/, "");
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/api/", "/*/admin", "/*/settings", "/*/t/", "/*/p/", "/*/i/", "/*/invite", "/*/reset-password", "/*/verify-email", "/*/mfa", "/*/unsubscribe"],
      },
    ],
    sitemap: `${origin}/sitemap.xml`,
    host: origin,
  };
}
