import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { buyInput, buyNumber, listPhoneNumbers } from "@/server/modules/voice/numbers";

type P = { orgId: string; companyId: string };

export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId }) => ({ data: await listPhoneNumbers(ctx, orgId, companyId) }));
export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/voice/numbers", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ req, ctx }, { orgId, companyId }) => buyNumber(ctx, orgId, companyId, await body(req, buyInput)),
);
