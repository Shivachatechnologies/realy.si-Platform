import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { askCeo, askInput, listConversations } from "@/server/modules/workforce/ceo-chat";

type P = { orgId: string; companyId: string };

export const GET = route<P>({ auth: "required" }, async ({ req, ctx }, { orgId, companyId }) => listConversations(ctx, orgId, companyId, Object.fromEntries(req.nextUrl.searchParams)));
/** Ask the CEO a question (new thread unless conversationId is given). */
export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/intelligence/conversations", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ req, ctx }, { orgId, companyId }) => askCeo(ctx, orgId, companyId, await body(req, askInput)),
);
