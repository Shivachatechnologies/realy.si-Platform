import { z } from "zod";
import { body, route } from "@/server/core/http";
import { verifyMfa } from "@/server/modules/auth/service";

export const POST = route({ auth: "mfa-pending", rateLimit: { name: "mfa-verify", limit: 10, windowMs: 60_000 } }, async ({ req, ctx, session }) => {
  const { code } = await body(req, z.object({ code: z.string().min(6).max(20) }));
  await verifyMfa(ctx, session!.id, session!.userId, code);
  return { ok: true };
});
