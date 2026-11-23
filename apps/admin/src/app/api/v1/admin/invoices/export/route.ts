import { route } from "@/server/core/http";
import { exportInvoicesCsv } from "@/server/modules/billing/explorers";

/** CSV of the filtered invoice mirror (same filters as /invoices; at most 5,000 rows). */
export const GET = route({ auth: "required", name: "GET /admin/invoices/export" }, async ({ req, ctx }) => {
  const csv = await exportInvoicesCsv(ctx, Object.fromEntries(req.nextUrl.searchParams));
  return new Response(csv, {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="realy-invoices-${new Date().toISOString().slice(0, 10)}.csv"`, "cache-control": "no-store" },
  });
});
