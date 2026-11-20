import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { applyAiDraft, applyAiInput } from "@/server/modules/crm/proposals";

type P = { orgId: string; companyId: string; proposalId: string };

/** "Use AI draft": copy the completed task's output into the proposal sections. */
export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/crm/proposals/:proposalId/ai/apply", rateLimits: LIMITS.tenantWrite },
  async ({ req, ctx }, { orgId, companyId, proposalId }) => applyAiDraft(ctx, orgId, companyId, proposalId, await body(req, applyAiInput)),
);
