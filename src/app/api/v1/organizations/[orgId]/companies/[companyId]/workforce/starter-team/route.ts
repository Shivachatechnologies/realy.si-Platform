import { LIMITS } from "@/server/core/limits";
import { route } from "@/server/core/http";
import { hireStarterTeam } from "@/server/modules/workforce/service";

export const POST = route<{ orgId: string; companyId: string }>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/workforce/starter-team", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ ctx }, { orgId, companyId }) => hireStarterTeam(ctx, orgId, companyId),
);
