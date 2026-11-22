import { route } from "@/server/core/http";
import { listPlatformInvoices } from "@/server/modules/billing/explorers";

/** Invoice mirror explorer (filters: org, status, overdue, currency, q, from, to; keyset cursor). */
export const GET = route({ auth: "required", name: "GET /admin/invoices" }, async ({ req, ctx }) => listPlatformInvoices(ctx, Object.fromEntries(req.nextUrl.searchParams)));
