import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { addAttachment, attachmentInput } from "@/server/modules/support/tickets";

type P = { orgId: string; companyId: string; ticketId: string };

/** JSON { fileName, contentType, dataBase64, messageId? }; files up to 5 MB (base64 adds a third). */
export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/support/tickets/:ticketId/attachments", rateLimits: LIMITS.tenantWrite, maxBodyBytes: 7 * 1024 * 1024 + 4096 },
  async ({ req, ctx }, { orgId, companyId, ticketId }) => addAttachment(ctx, orgId, companyId, ticketId, await body(req, attachmentInput)),
);
