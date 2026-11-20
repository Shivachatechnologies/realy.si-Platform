import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { archiveProposal, getProposal, proposalPatch, updateProposal } from "@/server/modules/crm/proposals";

type P = { orgId: string; companyId: string; proposalId: string };

export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId, proposalId }) => getProposal(ctx, orgId, companyId, proposalId));
export const PATCH = route<P>(
  { auth: "required", name: "PATCH /organizations/:orgId/companies/:companyId/crm/proposals/:proposalId", rateLimits: LIMITS.tenantWrite, maxBodyBytes: 256 * 1024 },
  async ({ req, ctx }, { orgId, companyId, proposalId }) => updateProposal(ctx, orgId, companyId, proposalId, await body(req, proposalPatch)),
);
export const DELETE = route<P>(
  { auth: "required", name: "DELETE /organizations/:orgId/companies/:companyId/crm/proposals/:proposalId", rateLimits: LIMITS.tenantWrite },
  async ({ ctx }, { orgId, companyId, proposalId }) => archiveProposal(ctx, orgId, companyId, proposalId),
);
