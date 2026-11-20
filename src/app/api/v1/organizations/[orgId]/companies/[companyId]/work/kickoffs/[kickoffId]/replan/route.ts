import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { replanKickoff, replanInput } from "@/server/modules/work/kickoff";

type P = { orgId: string; companyId: string; kickoffId: string };

export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/work/kickoffs/:kickoffId/replan", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId, kickoffId }) =>
  replanKickoff(ctx, orgId, companyId, kickoffId, await body(req, replanInput)),
);
