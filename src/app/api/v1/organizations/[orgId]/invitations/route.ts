import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { inviteInput, inviteMember } from "@/server/modules/organizations/service";

/** Returns the invitation id only; the token is delivered to the invitee by email, never to the inviter. */
export const POST = route<{ orgId: string }>({ auth: "required", name: "POST /organizations/:orgId/invitations", rateLimits: LIMITS.invitationCreate, idempotent: true }, async ({ req, ctx }, { orgId }) => {
  const { invitationId } = await inviteMember(ctx, orgId, await body(req, inviteInput));
  return { invitationId };
});
