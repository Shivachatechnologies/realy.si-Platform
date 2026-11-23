import { z } from "zod";
import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { unlockAllEntitlements, unlockAllInput } from "@/server/modules/entitlements/admin";

const input = unlockAllInput.omit({ organizationId: true });

/** Internal / owner accounts: enable every feature and Scale limits for one organization. Reason required; audited. */
export const POST = route<{ orgId: string }>({ auth: "required", name: "POST /admin/entitlements/organizations/:orgId/unlock-all", rateLimits: LIMITS.admin, idempotent: true }, async ({ req, ctx }, { orgId }) =>
  unlockAllEntitlements(ctx, { ...(await body(req, input)), organizationId: z.string().uuid().parse(orgId) }),
);
