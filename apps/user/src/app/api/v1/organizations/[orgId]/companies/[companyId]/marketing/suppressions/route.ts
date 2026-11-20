import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { addSuppression, listSuppressions, suppressionInput } from "@/server/modules/marketing/deliverability";

type P = { orgId: string; companyId: string };
export const GET = route<P>({ auth: "required" }, async ({ req, ctx }, { orgId, companyId }) => listSuppressions(ctx, orgId, companyId, req.nextUrl.searchParams.get("q") ?? undefined));
export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/marketing/suppressions", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId }) => addSuppression(ctx, orgId, companyId, await body(req, suppressionInput)));
