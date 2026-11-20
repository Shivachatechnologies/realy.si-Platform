import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { grantRoleByEmail, grantRoleInput, platformRolesOverview } from "@/server/modules/admin/roles";

export const GET = route({ auth: "required", name: "GET /admin/roles" }, async ({ ctx }) => platformRolesOverview(ctx));

/** Grant a platform role by email, with reason and MFA re-check (mfaCode). */
export const POST = route({ auth: "required", name: "POST /admin/roles", rateLimits: LIMITS.admin, idempotent: true }, async ({ req, ctx }) => grantRoleByEmail(ctx, await body(req, grantRoleInput)));
