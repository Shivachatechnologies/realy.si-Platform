import { LIMITS } from "@/server/core/limits";
import { route } from "@/server/core/http";
import { rotateHookSecret } from "@/server/modules/integrations/webhooks";

type P = { orgId: string; companyId: string; hookId: string };

export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/integration-hooks/:hookId/rotate", rateLimits: LIMITS.tenantWrite },
  async ({ ctx }, { orgId, companyId, hookId }) => rotateHookSecret(ctx, orgId, companyId, hookId),
);
