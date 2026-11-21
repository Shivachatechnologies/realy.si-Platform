import { LIMITS } from "@/server/core/limits";
import { route } from "@/server/core/http";
import { approveAndSend } from "@/server/modules/crm/outreach";

type P = { orgId: string; companyId: string; messageId: string };

/** A person approves the exact text and sends it through the company's connected email provider. */
export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/crm/outreach/:messageId/send", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ ctx }, { orgId, companyId, messageId }) => approveAndSend(ctx, orgId, companyId, messageId),
);
