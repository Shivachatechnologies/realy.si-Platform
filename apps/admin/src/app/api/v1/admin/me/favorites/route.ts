import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { favoriteInput, setFavorite } from "@/server/modules/admin/preferences";

/** Star or unstar a console page: POST { href, on }. */
export const POST = route({ auth: "required", name: "POST /admin/me/favorites", rateLimits: LIMITS.admin }, async ({ req, ctx }) => setFavorite(ctx, await body(req, favoriteInput)));
