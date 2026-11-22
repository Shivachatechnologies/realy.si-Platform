import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { addMembershipInput, adminAddUserMembership } from "@/server/modules/admin/people";

/** Add the user to an organization (by id or slug) with an organization role. */
export const POST = route<{ userId: string }>({ auth: "required", name: "POST /admin/users/:id/memberships", rateLimits: LIMITS.admin, idempotent: true }, async ({ req, ctx }, { userId }) =>
  adminAddUserMembership(ctx, userId, await body(req, addMembershipInput)),
);
