import { body, route } from "@/server/core/http";
import { markInput, markNotifications } from "@/server/modules/admin/notifications";

/** Mark notifications: POST { ids: [...], read?: boolean } or { all: true }. Only notifications the caller can see. */
export const POST = route({ auth: "required", name: "POST /admin/notifications/read" }, async ({ req, ctx }) => markNotifications(ctx, await body(req, markInput)));
