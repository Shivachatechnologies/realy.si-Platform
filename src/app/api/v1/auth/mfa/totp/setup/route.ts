import { route } from "@/server/core/http";
import { beginTotpSetup } from "@/server/modules/auth/service";

export const POST = route({ auth: "required" }, async ({ ctx, session }) => beginTotpSetup(ctx, session!.userId));
