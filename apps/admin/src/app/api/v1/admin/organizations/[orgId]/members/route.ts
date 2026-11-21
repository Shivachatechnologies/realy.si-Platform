import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { adminAddMember, memberInput, organizationMembers } from "@/server/modules/admin/people";

type P = { orgId: string };

export const GET = route<P>({ auth: "required", name: "GET /admin/organizations/:id/members" }, async ({ ctx }, { orgId }) => ({ data: await organizationMembers(ctx, orgId) }));

/** Add an existing user with an organization role (owner / admin / member). */
export const POST = route<P>({ auth: "required", name: "POST /admin/organizations/:id/members", rateLimits: LIMITS.admin, idempotent: true }, async ({ req, ctx }, { orgId }) =>
  adminAddMember(ctx, orgId, await body(req, memberInput)),
);
