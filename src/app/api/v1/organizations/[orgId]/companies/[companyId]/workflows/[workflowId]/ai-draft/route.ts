import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { requestAiDraft, aiDraftInput } from "@/server/modules/automation/service";

type P = { orgId: string; companyId: string; workflowId: string };

/** Ask the automation architect AI to draft this workflow. */
export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/workflows/:workflowId/ai-draft", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ req, ctx }, { orgId, companyId, workflowId }) => requestAiDraft(ctx, orgId, companyId, workflowId, await body(req, aiDraftInput)),
);
