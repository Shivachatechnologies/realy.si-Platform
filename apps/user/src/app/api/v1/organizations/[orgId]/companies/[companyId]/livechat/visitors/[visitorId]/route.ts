import { LIMITS } from "@/server/core/limits";
import { route } from "@/server/core/http";
import { deleteVisitorData } from "@/server/modules/livechat/inbox";

type P = { orgId: string; companyId: string; visitorId: string };

/** GDPR: erase a visitor with all their chats. */
export const DELETE = route<P>(
  { auth: "required", name: "DELETE /organizations/:orgId/companies/:companyId/livechat/visitors/:visitorId", rateLimits: LIMITS.tenantWrite },
  async ({ ctx }, { orgId, companyId, visitorId }) => deleteVisitorData(ctx, orgId, companyId, visitorId),
);
