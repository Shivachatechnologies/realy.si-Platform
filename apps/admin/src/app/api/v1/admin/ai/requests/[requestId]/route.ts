import { route } from "@/server/core/http";
import { getAiRequest } from "@/server/modules/admin/ai-requests";

/** One AI request attempt with its sibling attempts (sensitive fields need platform.data.read). */
export const GET = route<{ requestId: string }>({ auth: "required", name: "GET /admin/ai/requests/:id" }, async ({ ctx }, { requestId }) => getAiRequest(ctx, requestId));
