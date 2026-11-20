import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { changeMembers, membersInput } from "@/server/modules/marketing/segments";

type P = { orgId: string; companyId: string; segmentId: string };
export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/marketing/segments/:segmentId/members", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId, segmentId }) => changeMembers(ctx, orgId, companyId, segmentId, await body(req, membersInput)));
