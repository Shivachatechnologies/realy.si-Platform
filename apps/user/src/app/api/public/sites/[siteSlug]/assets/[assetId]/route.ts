import { z } from "zod";
import { route } from "@/server/core/http";
import { LIMITS } from "@/server/core/limits";
import { publicSiteAsset } from "@/server/modules/sites/public";

type P = { siteSlug: string; assetId: string };

/** Images of a published site (only assets the live site references; same-origin for the CSP). */
export const GET = route<P>({ auth: "none", name: "GET /public/sites/:siteSlug/assets/:assetId", rateLimits: LIMITS.publicRead }, async (_args, { siteSlug, assetId }) => {
  if (!z.string().uuid().safeParse(assetId).success) return new Response("Not found", { status: 404 });
  const f = await publicSiteAsset(siteSlug, assetId);
  if (!f) return new Response("Not found", { status: 404 });
  const type = /^image\/(png|jpeg|webp|gif|avif)$/.test(f.contentType) ? f.contentType : f.contentType === "image/svg+xml" ? "image/svg+xml" : "application/octet-stream";
  const headers: Record<string, string> = { "content-type": type, "cache-control": "public, max-age=3600", "x-content-type-options": "nosniff" };
  // SVGs are served with a locked-down CSP so scripts inside them never run.
  if (type === "image/svg+xml") headers["content-security-policy"] = "default-src 'none'; style-src 'unsafe-inline'; sandbox";
  return new Response(new Uint8Array(f.body), { headers });
});
