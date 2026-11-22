import { LIMITS } from "@/server/core/limits";
import { route } from "@/server/core/http";
import { runIntegrityChecksAsAdmin } from "@/server/modules/admin/data-ops";

/** Run the read-only integrity checks now (audited). */
export const POST = route({ auth: "required", name: "POST /admin/data/integrity", rateLimits: LIMITS.admin }, async ({ ctx }) => ({ checks: await runIntegrityChecksAsAdmin(ctx) }));
