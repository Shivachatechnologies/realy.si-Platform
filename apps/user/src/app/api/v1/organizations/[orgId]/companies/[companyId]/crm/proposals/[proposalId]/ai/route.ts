import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { aiDraftInput, draftProposalWithAi } from "@/server/modules/crm/proposals";

type P = { orgId: string; companyId: string; proposalId: string };

/** "Draft with AI": an account_executive agent task linked to the proposal (subject crm_proposal). */
export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/crm/proposals/:proposalId/ai", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ req, ctx }, { orgId, companyId, proposalId }) => draftProposalWithAi(ctx, orgId, companyId, proposalId, await body(req, aiDraftInput)),
);
