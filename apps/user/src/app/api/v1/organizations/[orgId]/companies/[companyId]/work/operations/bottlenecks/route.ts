import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { detectBottlenecks, fixBottleneck, fixInput } from "@/server/modules/work/bottlenecks";

type P = { orgId: string; companyId: string };

export const GET = route<P>({ auth: "required", name: "GET /organizations/:orgId/companies/:companyId/work/operations/bottlenecks" }, async ({ ctx }, { orgId, companyId }) => detectBottlenecks(ctx, orgId, companyId));

/** "Fix this": a follow-up task or an automation draft for one detected bottleneck. */
export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/work/operations/bottlenecks", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId }) => fixBottleneck(ctx, orgId, companyId, await body(req, fixInput)));
