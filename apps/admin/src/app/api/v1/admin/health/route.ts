import { route } from "@/server/core/http";
import { healthCenter } from "@/server/modules/admin/health";

/** Health center: per-service status, latency, last check, uptime and 24 h history (from the stored probe rows). */
export const GET = route({ auth: "required", name: "GET /admin/health" }, async ({ ctx }) => healthCenter(ctx));
