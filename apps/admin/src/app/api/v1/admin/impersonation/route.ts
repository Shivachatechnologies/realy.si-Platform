import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { listImpersonations, startImpersonation, startImpersonationInput } from "@/server/modules/admin/impersonation";

export const GET = route({ auth: "required", name: "GET /admin/impersonation" }, async ({ req, ctx }) => listImpersonations(ctx, Object.fromEntries(req.nextUrl.searchParams)));

/** Start an audited impersonation; returns the one-time user-app link (never stored). */
export const POST = route({ auth: "required", name: "POST /admin/impersonation", rateLimits: LIMITS.admin }, async ({ req, ctx }) => startImpersonation(ctx, await body(req, startImpersonationInput)));
