import { route } from "@/server/core/http";
import { listAiRequests } from "@/server/modules/admin/ai-requests";

/** AI request explorer (keyset pagination; filters as query parameters). */
export const GET = route({ auth: "required", name: "GET /admin/ai/requests" }, async ({ req, ctx }) => listAiRequests(ctx, Object.fromEntries(req.nextUrl.searchParams)));
