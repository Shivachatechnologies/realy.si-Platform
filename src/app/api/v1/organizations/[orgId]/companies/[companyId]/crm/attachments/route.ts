import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { attachmentInput, uploadAttachment } from "@/server/modules/crm/activities";

type P = { orgId: string; companyId: string };

/** POST { subjectType, subjectId, name, mimeType, data: base64 } — files up to 5 MB. */
export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/crm/attachments", rateLimits: LIMITS.tenantWrite, idempotent: true, maxBodyBytes: 7_500_000 },
  async ({ req, ctx }, { orgId, companyId }) => uploadAttachment(ctx, orgId, companyId, await body(req, attachmentInput)),
);
