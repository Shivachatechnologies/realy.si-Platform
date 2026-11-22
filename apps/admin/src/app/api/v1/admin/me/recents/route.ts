import { body, route } from "@/server/core/http";
import { clearHistory, pushRecent, recentInput } from "@/server/modules/admin/preferences";

/**
 * Recently visited console pages: POST { href, label } (sent by the sidebar when the section changes; a repeat of the
 * newest entry writes nothing), DELETE ?what=recents|searches|all clears history. Own row only.
 */
export const POST = route({ auth: "required", name: "POST /admin/me/recents" }, async ({ req, ctx }) => pushRecent(ctx, await body(req, recentInput)));

export const DELETE = route({ auth: "required", name: "DELETE /admin/me/recents" }, async ({ req, ctx }) => {
  const what = req.nextUrl.searchParams.get("what") ?? "all";
  return clearHistory(ctx, { recents: what === "recents" || what === "all", searches: what === "searches" || what === "all" });
});
