import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { deleteMessage, editMessage, editMessageInput } from "@/server/modules/comms/channels";

type P = { orgId: string; companyId: string; messageId: string };

export const PATCH = route<P>(
  { auth: "required", name: "PATCH /organizations/:orgId/companies/:companyId/comms/messages/:messageId", rateLimits: LIMITS.tenantWrite },
  async ({ req, ctx }, { orgId, companyId, messageId }) => editMessage(ctx, orgId, companyId, messageId, await body(req, editMessageInput)),
);
export const DELETE = route<P>(
  { auth: "required", name: "DELETE /organizations/:orgId/companies/:companyId/comms/messages/:messageId", rateLimits: LIMITS.tenantWrite },
  async ({ ctx }, { orgId, companyId, messageId }) => deleteMessage(ctx, orgId, companyId, messageId),
);
