import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { adminRejectApproval, rejectApprovalInput } from "@/server/modules/admin/ai-tasks";

/** Platform override: reject a pending approval of an AI task (typed confirmation REJECT, reason, audited). */
export const POST = route<{ approvalId: string }>({ auth: "required", name: "POST /admin/ai/approvals/:id/reject", rateLimits: LIMITS.admin }, async ({ req, ctx }, { approvalId }) =>
  adminRejectApproval(ctx, approvalId, await body(req, rejectApprovalInput)),
);
