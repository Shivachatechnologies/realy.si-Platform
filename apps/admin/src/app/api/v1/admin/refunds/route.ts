import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { issueRefund, refundInput } from "@/server/modules/billing/admin-actions";
import { listPlatformRefunds } from "@/server/modules/billing/explorers";

export const GET = route({ auth: "required", name: "GET /admin/refunds" }, async ({ req, ctx }) => listPlatformRefunds(ctx, Object.fromEntries(req.nextUrl.searchParams)));

/** Real Stripe refund: platform.billing.refund (MFA), reason, typed charge id. Never simulated. */
export const POST = route({ auth: "required", name: "POST /admin/refunds", rateLimits: LIMITS.admin, idempotent: true }, async ({ req, ctx }) => issueRefund(ctx, await body(req, refundInput)));
