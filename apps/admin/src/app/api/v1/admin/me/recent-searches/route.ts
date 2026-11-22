import { body, route } from "@/server/core/http";
import { pushRecentSearch, recentSearchInput } from "@/server/modules/admin/preferences";

/** Remember a ⌘K query the admin opened a result for: POST { q }. */
export const POST = route({ auth: "required", name: "POST /admin/me/recent-searches" }, async ({ req, ctx }) => pushRecentSearch(ctx, await body(req, recentSearchInput)));
