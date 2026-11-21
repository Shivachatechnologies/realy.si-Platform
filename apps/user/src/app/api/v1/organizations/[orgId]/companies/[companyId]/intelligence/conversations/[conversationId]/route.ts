import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { archiveConversation, conversationUpdateInput, getConversation, renameConversation } from "@/server/modules/workforce/ceo-chat";

type P = { orgId: string; companyId: string; conversationId: string };

export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId, conversationId }) => getConversation(ctx, orgId, companyId, conversationId));
export const PATCH = route<P>(
  { auth: "required", name: "PATCH /organizations/:orgId/companies/:companyId/intelligence/conversations/:id", rateLimits: LIMITS.tenantWrite },
  async ({ req, ctx }, { orgId, companyId, conversationId }) => renameConversation(ctx, orgId, companyId, conversationId, await body(req, conversationUpdateInput)),
);
export const DELETE = route<P>(
  { auth: "required", name: "DELETE /organizations/:orgId/companies/:companyId/intelligence/conversations/:id", rateLimits: LIMITS.tenantWrite },
  async ({ ctx }, { orgId, companyId, conversationId }) => archiveConversation(ctx, orgId, companyId, conversationId),
);
