import { route } from "@/server/core/http";
import { searchLogs } from "@/server/modules/admin/logs";

/** Merged log lines (source, level, q, requestId, organizationId, from, to, before, limit). platform.logs.read. */
export const GET = route({ auth: "required", name: "GET /admin/logs" }, async ({ req, ctx }) => searchLogs(ctx, Object.fromEntries(req.nextUrl.searchParams)));
