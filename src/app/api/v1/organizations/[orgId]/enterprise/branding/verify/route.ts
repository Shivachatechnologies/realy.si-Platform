import { LIMITS } from "@/server/core/limits";
import { route } from "@/server/core/http";
import { verifyCustomDomain } from "@/server/modules/enterprise/branding";

export const POST = route<{ orgId: string }>(
  {
    auth: "required",
    name: "POST /organizations/:orgId/enterprise/branding/verify",
    rateLimits: LIMITS.tenantWrite,
  },
  async ({ ctx }, { orgId }) => verifyCustomDomain(ctx, orgId),
);
