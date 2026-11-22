import { route } from "@/server/core/http";
import { infraOverview } from "@/server/modules/admin/infra";

/** Database, Redis (one cached INFO), worker processes and queue backlog. */
export const GET = route({ auth: "required", name: "GET /admin/infra" }, async ({ ctx }) => infraOverview(ctx));
