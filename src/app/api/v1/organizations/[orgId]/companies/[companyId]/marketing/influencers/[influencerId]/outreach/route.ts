import { z } from "zod";
import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { applyOutreachDraft, requestOutreachDraft, requestOutreachSend } from "@/server/modules/marketing/community";

const outreachBody = z.object({ action: z.enum(["draft", "apply", "send"]), taskId: z.string().uuid().optional() });
const outreach = async (ctx: Parameters<typeof requestOutreachDraft>[0], orgId: string, companyId: string, id: string, b: z.input<typeof outreachBody>) =>
  b.action === "draft" ? requestOutreachDraft(ctx, orgId, companyId, id) : b.action === "apply" ? applyOutreachDraft(ctx, orgId, companyId, id, b.taskId ?? "") : requestOutreachSend(ctx, orgId, companyId, id);
type P = { orgId: string; companyId: string; influencerId: string };
export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/marketing/influencers/:influencerId/outreach", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId, influencerId }) => outreach(ctx, orgId, companyId, influencerId, await body(req, outreachBody)));
