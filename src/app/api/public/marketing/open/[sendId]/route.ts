import { route } from "@/server/core/http";
import { LIMITS } from "@/server/core/limits";
import { recordOpen, verifyOpen } from "@/server/modules/marketing/tracking";

const PIXEL = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");

/** Open-tracking pixel (signed per send). Always returns the GIF; records only valid signatures. */
export const GET = route<{ sendId: string }>({ auth: "none", rateLimits: LIMITS.publicRead }, async ({ req }, { sendId }) => {
  if (verifyOpen(sendId, req.nextUrl.searchParams.get("sig"))) await recordOpen(sendId).catch(() => undefined);
  return new Response(PIXEL, { headers: { "content-type": "image/gif", "cache-control": "no-store, max-age=0" } });
});
