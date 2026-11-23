import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { decideFileDeletion, deletionDecisionInput } from "@/server/modules/admin/files-admin";

/** Approve, reject or cancel a file deletion request. */
export const POST = route<{ requestId: string }>({ auth: "required", name: "POST /admin/files/deletions/:requestId", rateLimits: LIMITS.admin }, async ({ req, ctx }, { requestId }) => decideFileDeletion(ctx, requestId, await body(req, deletionDecisionInput)));
