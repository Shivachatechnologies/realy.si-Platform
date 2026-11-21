import { LIMITS } from "@/server/core/limits";
import { route } from "@/server/core/http";
import { startWhatsAppVerification } from "@/server/modules/briefing/service";

type P = { orgId: string; companyId: string };

export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/briefing/whatsapp/verify", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ ctx }, { orgId, companyId }) => startWhatsAppVerification(ctx, orgId, companyId),
);
