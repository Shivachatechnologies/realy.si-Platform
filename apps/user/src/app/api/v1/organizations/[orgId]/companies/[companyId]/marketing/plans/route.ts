import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { createPlan, listPlans, planInput } from "@/server/modules/marketing/plans";

type P = { orgId: string; companyId: string };
export const GET = route<P>({ auth: "required" }, async ({ req, ctx }, { orgId, companyId }) => ({ data: await listPlans(ctx, orgId, companyId, req.nextUrl.searchParams.get("archived") === "1") }));
export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/marketing/plans", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId }) => createPlan(ctx, orgId, companyId, await body(req, planInput)));
