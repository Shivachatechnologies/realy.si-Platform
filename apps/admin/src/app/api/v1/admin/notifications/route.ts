import { route } from "@/server/core/http";
import { listNotifications } from "@/server/modules/admin/notifications";

/** The caller's admin notifications, newest first: GET ?filter=all|unread&severity=&type=&cursor=&limit= (max 100). */
export const GET = route({ auth: "required", name: "GET /admin/notifications" }, async ({ req, ctx }) => listNotifications(ctx, Object.fromEntries(req.nextUrl.searchParams)));
