import { route } from "@/server/core/http";
import { listErrorGroups } from "@/server/modules/admin/errors";

/** Error groups (status, source, q, assignee, since, cursor). */
export const GET = route({ auth: "required", name: "GET /admin/errors" }, async ({ req, ctx }) => listErrorGroups(ctx, Object.fromEntries(req.nextUrl.searchParams)));
