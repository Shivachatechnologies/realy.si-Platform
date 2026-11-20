import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { emailAi, emailAiInput } from "@/server/modules/comms/email";

type P = { orgId: string; companyId: string; threadId: string };

export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/comms/email/threads/:threadId/ai", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ req, ctx }, { orgId, companyId, threadId }) => emailAi(ctx, orgId, companyId, threadId, await body(req, emailAiInput)),
);
