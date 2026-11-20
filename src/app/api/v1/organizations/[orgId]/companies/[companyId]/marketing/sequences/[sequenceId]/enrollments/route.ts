import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { enroll, enrollInput } from "@/server/modules/marketing/sequences";

type P = { orgId: string; companyId: string; sequenceId: string };
export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/marketing/sequences/:sequenceId/enrollments", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId, sequenceId }) => enroll(ctx, orgId, companyId, sequenceId, await body(req, enrollInput)));
