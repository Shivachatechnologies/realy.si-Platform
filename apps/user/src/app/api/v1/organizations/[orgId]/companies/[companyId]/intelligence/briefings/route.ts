import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { briefingInput, generateBriefing, listBriefings } from "@/server/modules/workforce/briefings";

type P = { orgId: string; companyId: string };

export const GET = route<P>({ auth: "required" }, async ({ req, ctx }, { orgId, companyId }) => listBriefings(ctx, orgId, companyId, Object.fromEntries(req.nextUrl.searchParams)));
export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/intelligence/briefings", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ req, ctx }, { orgId, companyId }) => generateBriefing(ctx, orgId, companyId, await body(req, briefingInput)),
);
