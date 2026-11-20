import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { decideByToken, decideByTokenInput } from "@/server/modules/briefing/service";

type P = { orgId: string; companyId: string };

/** One-tap decision from a briefing link: needs the recipient's session plus the single-use token. */
export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/briefing/decide", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ req, ctx }, { orgId, companyId }) => decideByToken(ctx, orgId, companyId, await body(req, decideByTokenInput)),
);
