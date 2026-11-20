import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { getThread, threadUpdateInput, updateThread } from "@/server/modules/comms/email";

type P = { orgId: string; companyId: string; threadId: string };

export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId, threadId }) => getThread(ctx, orgId, companyId, threadId));
export const PATCH = route<P>(
  { auth: "required", name: "PATCH /organizations/:orgId/companies/:companyId/comms/email/threads/:threadId", rateLimits: LIMITS.tenantWrite },
  async ({ req, ctx }, { orgId, companyId, threadId }) => updateThread(ctx, orgId, companyId, threadId, await body(req, threadUpdateInput)),
);
