import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { adminRemoveMember, adminSetMemberRole, memberRemoveInput, memberRoleInput } from "@/server/modules/admin/people";

type P = { orgId: string; userId: string };

export const PUT = route<P>({ auth: "required", name: "PUT /admin/organizations/:id/members/:userId", rateLimits: LIMITS.admin }, async ({ req, ctx }, { orgId, userId }) =>
  adminSetMemberRole(ctx, orgId, userId, await body(req, memberRoleInput)),
);

export const DELETE = route<P>({ auth: "required", name: "DELETE /admin/organizations/:id/members/:userId", rateLimits: LIMITS.admin }, async ({ req, ctx }, { orgId, userId }) =>
  adminRemoveMember(ctx, orgId, userId, await body(req, memberRemoveInput)),
);
