import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { announcementInput, announcementsOverview, sendAnnouncement } from "@/server/modules/admin/announcements";

export const GET = route({ auth: "required", name: "GET /admin/announcements" }, async ({ ctx }) => announcementsOverview(ctx));

/** Send an in-app announcement to all or selected organizations. */
export const POST = route({ auth: "required", name: "POST /admin/announcements", rateLimits: LIMITS.admin, idempotent: true }, async ({ req, ctx }) => sendAnnouncement(ctx, await body(req, announcementInput)));
