import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { assignKickoff, assignInput } from "@/server/modules/work/kickoff";

type P = { orgId: string; companyId: string; kickoffId: string };

export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/work/kickoffs/:kickoffId/assign", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId, kickoffId }) =>
  assignKickoff(ctx, orgId, companyId, kickoffId, await body(req, assignInput)),
);
