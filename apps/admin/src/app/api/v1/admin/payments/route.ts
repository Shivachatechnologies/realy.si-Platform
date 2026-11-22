import { route } from "@/server/core/http";
import { listPlatformPayments } from "@/server/modules/billing/explorers";

/** Payment (charge) mirror explorer. */
export const GET = route({ auth: "required", name: "GET /admin/payments" }, async ({ req, ctx }) => listPlatformPayments(ctx, Object.fromEntries(req.nextUrl.searchParams)));
