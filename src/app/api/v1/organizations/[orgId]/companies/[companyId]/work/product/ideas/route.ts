import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { ideaInput, listIdeas, parseIdeaFilters, submitIdea } from "@/server/modules/work/product";

type P = { orgId: string; companyId: string };

export const GET = route<P>({ auth: "required" }, async ({ req, ctx }, { orgId, companyId }) => listIdeas(ctx, orgId, companyId, parseIdeaFilters(Object.fromEntries(req.nextUrl.searchParams))));
export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/work/product/ideas", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId }) => submitIdea(ctx, orgId, companyId, await body(req, ideaInput)));
