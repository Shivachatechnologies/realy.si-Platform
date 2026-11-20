import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { bannerInput, setBanner } from "@/server/modules/admin/announcements";

/** Site-wide banner (maintenance notices) shown in the user app. */
export const PUT = route({ auth: "required", name: "PUT /admin/banner", rateLimits: LIMITS.admin }, async ({ req, ctx }) => setBanner(ctx, await body(req, bannerInput)));
