import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { adjustCredits, creditAdjustInput } from "@/server/modules/admin/credits";

/** ± allowance for an organization's current window (credit ledger ADJUSTMENT / PROMOTION / REFUND; MFA, reason). */
export const POST = route({ auth: "required", name: "POST /admin/credits/adjustments", rateLimits: LIMITS.admin, idempotent: true }, async ({ req, ctx }) => adjustCredits(ctx, await body(req, creditAdjustInput)));
