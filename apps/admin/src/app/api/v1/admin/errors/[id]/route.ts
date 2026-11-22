import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { errorGroupUpdateInput, getErrorGroup, updateErrorGroup } from "@/server/modules/admin/errors";

/** One group: events (stack traces need platform.logs.read), releases, routes, related logs and incident. */
export const GET = route<{ id: string }>({ auth: "required", name: "GET /admin/errors/:id" }, async ({ req, ctx }, { id }) => getErrorGroup(ctx, id, { eventsCursor: req.nextUrl.searchParams.get("cursor") ?? undefined }));

/** Status, assignee, note, incident link (platform.incidents.manage or platform.alerts.manage; reason audited). */
export const PATCH = route<{ id: string }>({ auth: "required", name: "PATCH /admin/errors/:id", rateLimits: LIMITS.admin }, async ({ req, ctx }, { id }) =>
  updateErrorGroup(ctx, id, await body(req, errorGroupUpdateInput)),
);
