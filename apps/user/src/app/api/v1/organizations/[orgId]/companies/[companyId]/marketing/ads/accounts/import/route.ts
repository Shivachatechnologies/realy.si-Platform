import { z } from "zod";
import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { importAdAccounts } from "@/server/modules/marketing/ads";

const providerInput = z.object({ provider: z.string().max(40) });
type P = { orgId: string; companyId: string };
export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/marketing/ads/accounts/import", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId }) => importAdAccounts(ctx, orgId, companyId, (await body(req, providerInput)).provider));
