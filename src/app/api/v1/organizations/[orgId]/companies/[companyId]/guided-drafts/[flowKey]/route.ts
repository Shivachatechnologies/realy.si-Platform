import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { clearDraft, draftInput, getDraft, saveDraft } from "@/server/modules/cockpit/drafts";

type P = { orgId: string; companyId: string; flowKey: string };

export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId, flowKey }) => getDraft(ctx, orgId, companyId, flowKey));
export const PUT = route<P>(
  { auth: "required", name: "PUT /organizations/:orgId/companies/:companyId/guided-drafts/:flowKey", rateLimits: LIMITS.tenantWrite },
  async ({ req, ctx }, { orgId, companyId, flowKey }) => saveDraft(ctx, orgId, companyId, flowKey, await body(req, draftInput)),
);
export const DELETE = route<P>(
  { auth: "required", name: "DELETE /organizations/:orgId/companies/:companyId/guided-drafts/:flowKey", rateLimits: LIMITS.tenantWrite },
  async ({ ctx }, { orgId, companyId, flowKey }) => clearDraft(ctx, orgId, companyId, flowKey),
);
