import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { applyKickoff, applyInput } from "@/server/modules/work/kickoff";

type P = { orgId: string; companyId: string; kickoffId: string };

export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/work/kickoffs/:kickoffId/apply", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId, kickoffId }) =>
  applyKickoff(ctx, orgId, companyId, kickoffId, await body(req, applyInput)),
);
