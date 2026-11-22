import { route } from "@/server/core/http";
import { serviceHealthDetail } from "@/server/modules/admin/health";

/** One service: uptime windows, check history (cursor), failures, dependencies, configuration, incidents. */
export const GET = route<{ service: string }>({ auth: "required", name: "GET /admin/health/:service" }, async ({ req, ctx }, { service }) =>
  serviceHealthDetail(ctx, decodeURIComponent(service), Object.fromEntries(req.nextUrl.searchParams)),
);
