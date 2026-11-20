import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { shareInput, shareToChat } from "@/server/modules/comms/chat";

type P = { orgId: string; companyId: string };

export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/comms/share", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ req, ctx }, { orgId, companyId }) => shareToChat(ctx, orgId, companyId, await body(req, shareInput)),
);
