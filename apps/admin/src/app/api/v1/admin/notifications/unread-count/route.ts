import { route } from "@/server/core/http";
import { unreadNotificationCount } from "@/server/modules/admin/notifications";

/** Bell counter (capped at 100). The bell asks on focus at most once a minute, never in a tight loop. */
export const GET = route({ auth: "required", name: "GET /admin/notifications/unread-count" }, async ({ ctx }) => ({ count: await unreadNotificationCount(ctx) }));
