import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { replyInput, replyToThread } from "@/server/modules/comms/email";

type P = { orgId: string; companyId: string; threadId: string };

export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/comms/email/threads/:threadId/reply", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ req, ctx }, { orgId, companyId, threadId }) => replyToThread(ctx, orgId, companyId, threadId, await body(req, replyInput)),
);
