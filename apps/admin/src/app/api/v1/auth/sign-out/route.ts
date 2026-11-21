import { route } from "@/server/core/http";
import { revokeSession } from "@/server/modules/auth/session";
import { clearSessionCookie } from "../cookies";

export const POST = route({ auth: "mfa-pending" }, async ({ session }) => {
  await revokeSession(session!.id);
  return clearSessionCookie();
});
