import { route } from "@/server/core/http";
import { LIMITS } from "@/server/core/limits";
import { AppError } from "@/server/core/errors";
import { recordClick, verifyClick } from "@/server/modules/marketing/tracking";

/** Click redirect for links in marketing emails. Only signed (send, url) pairs redirect — never an open redirect. */
export const GET = route({ auth: "none", rateLimits: LIMITS.publicRead }, async ({ req }) => {
  const sendId = req.nextUrl.searchParams.get("s") ?? "";
  const url = req.nextUrl.searchParams.get("u") ?? "";
  if (!/^https?:\/\//i.test(url) || !verifyClick(sendId, url, req.nextUrl.searchParams.get("sig"))) throw new AppError("not_found", "Link not found");
  await recordClick(sendId, url).catch(() => undefined);
  return new Response(null, { status: 302, headers: { location: url, "cache-control": "no-store" } });
});
