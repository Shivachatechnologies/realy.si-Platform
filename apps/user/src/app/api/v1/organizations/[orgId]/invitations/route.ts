import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { db } from "@/server/core/db";
import { deliverInvitation, inviteInput, inviteMember, listInvitations } from "@/server/modules/organizations/service";

type P = { orgId: string };

export const GET = route<P>({ auth: "required", name: "GET /organizations/:orgId/invitations" }, async ({ ctx }, { orgId }) => ({
  data: await listInvitations(ctx, orgId),
}));

/**
 * Create and email an invitation. The token goes only to the invitee's inbox; the response reports the
 * real delivery status (SENT | FAILED | NOT_CONFIGURED) instead of implying an email was sent.
 */
export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/invitations", rateLimits: LIMITS.invitationCreate, idempotent: true },
  async ({ req, ctx, session }, { orgId }) => {
    const { invitationId, token } = await inviteMember(ctx, orgId, await body(req, inviteInput));
    const inviter = await db().user.findUniqueOrThrow({ where: { id: session!.userId }, select: { locale: true } });
    const delivery = await deliverInvitation(ctx, invitationId, token, inviter.locale);
    return { invitationId, delivery };
  },
);
