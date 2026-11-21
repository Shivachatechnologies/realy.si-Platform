import { LIMITS } from "@/server/core/limits";
import { route } from "@/server/core/http";
import { revokeInvitation } from "@/server/modules/organizations/service";

export const DELETE = route<{ orgId: string; invitationId: string }>(
  { auth: "required", name: "DELETE /organizations/:orgId/invitations/:id", rateLimits: LIMITS.tenantWrite },
  async ({ ctx }, { orgId, invitationId }) => {
    await revokeInvitation(ctx, orgId, invitationId);
    return { ok: true };
  },
);
