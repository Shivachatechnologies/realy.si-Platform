import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { createSavedView, listSavedViews, savedViewInput } from "@/server/modules/admin/preferences";

/** Saved table views: GET ?page=<table id> (own + shared; without page: all own), POST { page, name, query, columns, shared }. */
export const GET = route({ auth: "required", name: "GET /admin/me/saved-views" }, async ({ req, ctx }) => ({ data: await listSavedViews(ctx, req.nextUrl.searchParams.get("page") ?? undefined) }));

export const POST = route({ auth: "required", name: "POST /admin/me/saved-views", rateLimits: LIMITS.admin, idempotent: true }, async ({ req, ctx }) => createSavedView(ctx, await body(req, savedViewInput)));
