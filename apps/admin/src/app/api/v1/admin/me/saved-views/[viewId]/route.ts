import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { deleteSavedView, savedViewPatch, updateSavedView } from "@/server/modules/admin/preferences";

/** One of the caller's own saved views: PATCH { name?, query?, columns?, shared? }, DELETE. */
export const PATCH = route<{ viewId: string }>({ auth: "required", name: "PATCH /admin/me/saved-views/:id", rateLimits: LIMITS.admin }, async ({ req, ctx }, { viewId }) => updateSavedView(ctx, viewId, await body(req, savedViewPatch)));

export const DELETE = route<{ viewId: string }>({ auth: "required", name: "DELETE /admin/me/saved-views/:id", rateLimits: LIMITS.admin }, async ({ ctx }, { viewId }) => deleteSavedView(ctx, viewId));
