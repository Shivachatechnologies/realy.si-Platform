import { LIMITS } from "@/server/core/limits";
import { route } from "@/server/core/http";
import { redeliver } from "@/server/modules/integrations/webhooks";

type P = { orgId: string; companyId: string; deliveryId: string };

export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/integration-webhook-deliveries/:deliveryId/redeliver", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ ctx }, { orgId, companyId, deliveryId }) => redeliver(ctx, orgId, companyId, deliveryId),
);
