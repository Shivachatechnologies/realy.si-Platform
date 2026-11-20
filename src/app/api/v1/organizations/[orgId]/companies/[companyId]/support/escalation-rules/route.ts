import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { escalationRuleInput, listEscalationRules, saveEscalationRule } from "@/server/modules/support/config";

type P = { orgId: string; companyId: string };

export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId }) => ({ data: await listEscalationRules(ctx, orgId, companyId) }));
export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/support/escalation-rules", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ req, ctx }, { orgId, companyId }) => saveEscalationRule(ctx, orgId, companyId, null, await body(req, escalationRuleInput)),
);
