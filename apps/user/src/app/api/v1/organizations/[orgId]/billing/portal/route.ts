import { z } from "zod";
import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { createPortalSession } from "@/server/modules/billing/stripe-billing";

export const POST = route<{ orgId: string }>(
  { auth: "required", name: "POST /organizations/:orgId/billing/portal", rateLimits: LIMITS.billing },
  async ({ req, ctx }, { orgId }) => {
    const { locale } = await body(req, z.object({ locale: z.string().max(35).optional() }));
    return createPortalSession(ctx, orgId, locale);
  },
);
