import { z } from "zod";
import { body, route } from "@/server/core/http";
import { confirmTotpSetup } from "@/server/modules/auth/service";

export const POST = route({ auth: "required" }, async ({ req, ctx, session }) => {
  const { code } = await body(req, z.object({ code: z.string().regex(/^\d{6}$/) }));
  return confirmTotpSetup(ctx, session!.id, session!.userId, code);
});
