import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { deleteRule, escalationRuleInput, saveEscalationRule } from "@/server/modules/support/config";

type P = { orgId: string; companyId: string; ruleId: string };

export const PATCH = route<P>(
  { auth: "required", name: "PATCH /organizations/:orgId/companies/:companyId/support/escalation-rules/:ruleId", rateLimits: LIMITS.tenantWrite },
  async ({ req, ctx }, { orgId, companyId, ruleId }) => saveEscalationRule(ctx, orgId, companyId, ruleId, await body(req, escalationRuleInput)),
);
export const DELETE = route<P>(
  { auth: "required", name: "DELETE /organizations/:orgId/companies/:companyId/support/escalation-rules/:ruleId", rateLimits: LIMITS.tenantWrite },
  async ({ ctx }, { orgId, companyId, ruleId }) => deleteRule(ctx, orgId, companyId, "escalation", ruleId),
);
