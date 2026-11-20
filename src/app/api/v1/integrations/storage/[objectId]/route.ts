import type { NextRequest } from "next/server";
import { db } from "@/server/core/db";
import { verifyDbObjectSignature } from "@/server/modules/integrations/services/storage";

/**
 * Serves objects of the storage service's database fallback. Access is by short-lived HMAC-signed URL only
 * (issued by putObject / getSignedUrl after the caller's own authorization), so it works in <img> tags and for
 * providers that fetch media by URL.
 */
export async function GET(req: NextRequest, ctx: RouteContext<"/api/v1/integrations/storage/[objectId]">) {
  const { objectId } = await ctx.params;
  const q = req.nextUrl.searchParams;
  if (!/^[0-9a-f-]{36}$/.test(objectId) || !verifyDbObjectSignature(objectId, q.get("exp"), q.get("sig"))) return new Response("Not found", { status: 404 });
  const obj = await db().integrationStoredObject.findUnique({ where: { id: objectId }, select: { data: true, contentType: true, size: true } });
  if (!obj) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(obj.data), {
    headers: {
      "content-type": obj.contentType,
      "content-length": String(obj.size),
      "cache-control": "private, max-age=3600",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; sandbox",
    },
  });
}
