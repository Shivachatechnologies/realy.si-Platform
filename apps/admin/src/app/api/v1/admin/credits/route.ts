import { route } from "@/server/core/http";
import { creditLedger } from "@/server/modules/admin/credits";

/** Credit ledger explorer (filters: org, meter, kind, from, to; cursor). */
export const GET = route({ auth: "required", name: "GET /admin/credits" }, async ({ req, ctx }) => creditLedger(ctx, Object.fromEntries(req.nextUrl.searchParams)));
