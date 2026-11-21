import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { sendProposal, sendProposalInput } from "@/server/modules/crm/proposals";

type P = { orgId: string; companyId: string; proposalId: string };

/** Email the share link; 503-style errors (not_configured / not_available) mean nothing was sent. */
export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/crm/proposals/:proposalId/send", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ req, ctx }, { orgId, companyId, proposalId }) => sendProposal(ctx, orgId, companyId, proposalId, await body(req, sendProposalInput)),
);
