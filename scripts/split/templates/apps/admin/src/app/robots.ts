import type { MetadataRoute } from "next";

/** The Control Center is never crawled. */
export default function robots(): MetadataRoute.Robots {
  return { rules: [{ userAgent: "*", disallow: "/" }] };
}
