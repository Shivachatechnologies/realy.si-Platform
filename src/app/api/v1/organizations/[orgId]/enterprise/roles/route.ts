import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { customRoleInput } from "@/server/modules/rbac/service";
import { createRole, roleBuilderData } from "@/server/modules/enterprise/roles";

type P = { orgId: string };

export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId }) => roleBuilderData(ctx, orgId));
export const POST = route<P>(
  {
    auth: "required",
    name: "POST /organizations/:orgId/enterprise/roles",
    rateLimits: LIMITS.tenantWrite,
    idempotent: true,
  },
  async ({ req, ctx }, { orgId }) => createRole(ctx, orgId, await body(req, customRoleInput)),
);
