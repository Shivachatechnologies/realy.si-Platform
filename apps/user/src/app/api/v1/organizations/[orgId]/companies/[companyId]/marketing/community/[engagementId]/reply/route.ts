import { z } from "zod";
import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { sendReply } from "@/server/modules/marketing/community";

const replyBody = z.object({ text: z.string().trim().max(3000).optional() });
type P = { orgId: string; companyId: string; engagementId: string };
export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/marketing/community/:engagementId/reply", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId, engagementId }) => sendReply(ctx, orgId, companyId, engagementId, (await body(req, replyBody)).text));
