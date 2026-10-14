import { LIMITS } from "@/server/core/limits";
import { route } from "@/server/core/http";
import { db } from "@/server/core/db";
import { resendInvitation } from "@/server/modules/organizations/service";

export const POST = route<{ orgId: string; invitationId: string }>(
  { auth: "required", name: "POST /organizations/:orgId/invitations/:id/resend", rateLimits: LIMITS.invitationCreate },
  async ({ ctx, session }, { orgId, invitationId }) => {
    const me = await db().user.findUniqueOrThrow({ where: { id: session!.userId }, select: { locale: true } });
    return { delivery: await resendInvitation(ctx, orgId, invitationId, me.locale) };
  },
);
