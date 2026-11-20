import { route } from "@/server/core/http";
import { LIMITS } from "@/server/core/limits";
import { publicAssetFile, verifyAssetSig } from "@/server/modules/marketing/assets";

/** Signed public media URL (social platforms and CMSs fetch creatives from here). `?download=1` forces a download. */
export const GET = route<{ assetId: string; file: string }>({ auth: "none", rateLimits: LIMITS.publicRead }, async ({ req }, { assetId, file }) => {
  if (!verifyAssetSig(assetId, req.nextUrl.searchParams.get("sig"))) return new Response("Not found", { status: 404 });
  const f = await publicAssetFile(assetId);
  if (!f) return new Response("Not found", { status: 404 });
  const headers: Record<string, string> = { "content-type": f.mimeType, "cache-control": "public, max-age=86400", "x-content-type-options": "nosniff" };
  if (req.nextUrl.searchParams.get("download")) headers["content-disposition"] = `attachment; filename="${file.replace(/[^\w.-]/g, "_")}"`;
  return new Response(new Uint8Array(f.bytes), { headers });
});
