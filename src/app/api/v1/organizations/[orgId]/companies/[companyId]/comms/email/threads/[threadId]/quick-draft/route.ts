import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { quickDraftInput, quickReplyDraft } from "@/server/modules/comms/customer-context";

type P = { orgId: string; companyId: string; threadId: string };

/** Instant, context-aware AI reply draft (returned for editing; never sent). */
export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/comms/email/threads/:threadId/quick-draft", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ req, ctx }, { orgId, companyId, threadId }) => quickReplyDraft(ctx, orgId, companyId, threadId, await body(req, quickDraftInput)),
);
