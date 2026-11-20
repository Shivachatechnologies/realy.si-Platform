import { LIMITS } from "@/server/core/limits";
import { route } from "@/server/core/http";
import { syncNumbers } from "@/server/modules/voice/numbers";

type P = { orgId: string; companyId: string };

export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/voice/numbers/sync", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ ctx }, { orgId, companyId }) => syncNumbers(ctx, orgId, companyId),
);
