import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { MAX_ATTACHMENT_BYTES, addAttachment, attachmentInput } from "@/server/modules/work/tasks";

type P = { orgId: string; companyId: string; taskId: string };

export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/work/tasks/:taskId/attachments", rateLimits: LIMITS.tenantWrite, idempotent: true, maxBodyBytes: Math.ceil((MAX_ATTACHMENT_BYTES * 4) / 3) + 16 * 1024 }, async ({ req, ctx }, { orgId, companyId, taskId }) => addAttachment(ctx, orgId, companyId, taskId, await body(req, attachmentInput)));
