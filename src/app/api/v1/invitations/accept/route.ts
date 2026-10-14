import { z } from "zod";
import { body, route } from "@/server/core/http";
import { acceptInvitation } from "@/server/modules/organizations/service";

export const POST = route({ auth: "required" }, async ({ req, ctx }) => {
  const { token } = await body(req, z.object({ token: z.string().min(20).max(128) }));
  return acceptInvitation(ctx, token);
});
