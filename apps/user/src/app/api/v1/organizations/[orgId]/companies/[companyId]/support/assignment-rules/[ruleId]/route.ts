import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { assignmentRuleInput, deleteRule, saveAssignmentRule } from "@/server/modules/support/config";

type P = { orgId: string; companyId: string; ruleId: string };

export const PATCH = route<P>(
  { auth: "required", name: "PATCH /organizations/:orgId/companies/:companyId/support/assignment-rules/:ruleId", rateLimits: LIMITS.tenantWrite },
  async ({ req, ctx }, { orgId, companyId, ruleId }) => saveAssignmentRule(ctx, orgId, companyId, ruleId, await body(req, assignmentRuleInput)),
);
export const DELETE = route<P>(
  { auth: "required", name: "DELETE /organizations/:orgId/companies/:companyId/support/assignment-rules/:ruleId", rateLimits: LIMITS.tenantWrite },
  async ({ ctx }, { orgId, companyId, ruleId }) => deleteRule(ctx, orgId, companyId, "assignment", ruleId),
);
