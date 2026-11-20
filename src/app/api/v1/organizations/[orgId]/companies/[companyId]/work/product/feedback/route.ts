import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { createFeedback, feedbackInput, listFeedback } from "@/server/modules/work/product";

type P = { orgId: string; companyId: string };

export const GET = route<P>({ auth: "required" }, async ({ req, ctx }, { orgId, companyId }) => listFeedback(ctx, orgId, companyId, Object.fromEntries(req.nextUrl.searchParams)));
export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/work/product/feedback", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId }) => createFeedback(ctx, orgId, companyId, await body(req, feedbackInput)));
