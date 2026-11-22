import { route } from "@/server/core/http";
import { dataOpsOverview } from "@/server/modules/admin/data-ops";

/** Migrations, last integrity run, retention registry and recent exports. */
export const GET = route({ auth: "required", name: "GET /admin/data" }, async ({ ctx }) => dataOpsOverview(ctx));
