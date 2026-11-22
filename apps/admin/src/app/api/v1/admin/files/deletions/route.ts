import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { deletionRequestInput, requestFileDeletion } from "@/server/modules/admin/files-admin";

/** Request deletion of one file (second admin approves). */
export const POST = route({ auth: "required", name: "POST /admin/files/deletions", rateLimits: LIMITS.admin }, async ({ req, ctx }) => requestFileDeletion(ctx, await body(req, deletionRequestInput)));
