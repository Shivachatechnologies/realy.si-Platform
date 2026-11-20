import { z } from "zod";
import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { saveReplyDraft } from "@/server/modules/marketing/community";

const draftBody = z.object({ text: z.string().max(3000).default(""), taskId: z.string().uuid().optional() });
type P = { orgId: string; companyId: string; engagementId: string };
export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/marketing/community/:engagementId/draft", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId, engagementId }) => saveReplyDraft(ctx, orgId, companyId, engagementId, { text: "", ...(await body(req, draftBody)) }));
