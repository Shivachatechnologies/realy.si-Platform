import { LIMITS } from "@/server/core/limits";
import { route } from "@/server/core/http";
import { createProposalEstimate } from "@/server/modules/crm/proposals";

type P = { orgId: string; companyId: string; proposalId: string };

/** Create a finance estimate draft from the proposal (needs finance.manage too). */
export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/crm/proposals/:proposalId/estimate", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ ctx }, { orgId, companyId, proposalId }) => createProposalEstimate(ctx, orgId, companyId, proposalId),
);
