import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { getPreferences, preferencesInput, updatePreferences } from "@/server/modules/admin/preferences";

/** The caller's console preferences: GET; PATCH { density?, timeRange?, sidebar?, notificationPrefs?, favorites? }. */
export const GET = route({ auth: "required", name: "GET /admin/me/preferences" }, async ({ ctx }) => getPreferences(ctx));

export const PATCH = route({ auth: "required", name: "PATCH /admin/me/preferences", rateLimits: LIMITS.admin }, async ({ req, ctx }) => updatePreferences(ctx, await body(req, preferencesInput)));
