import { route } from "@/server/core/http";
import { listFlags } from "@/server/modules/flags/service";

export const GET = route({ auth: "required" }, async ({ ctx }) => ({ data: await listFlags(ctx) }));
