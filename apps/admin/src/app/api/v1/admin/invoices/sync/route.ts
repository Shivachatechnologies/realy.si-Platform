import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { backfillInput, backfillStripe } from "@/server/modules/billing/admin-actions";

/** Admin backfill of the Stripe mirror (read-only towards Stripe; MFA, reason, audit; 300 objects per call). */
export const POST = route({ auth: "required", name: "POST /admin/invoices/sync", rateLimits: LIMITS.admin }, async ({ req, ctx }) => backfillStripe(ctx, await body(req, backfillInput)));
