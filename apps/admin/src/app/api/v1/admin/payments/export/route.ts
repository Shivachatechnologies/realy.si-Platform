import { route } from "@/server/core/http";
import { exportPaymentsCsv } from "@/server/modules/billing/explorers";

/** CSV of the filtered payment mirror (at most 5,000 rows; card data limited to brand and last 4). */
export const GET = route({ auth: "required", name: "GET /admin/payments/export" }, async ({ req, ctx }) => {
  const csv = await exportPaymentsCsv(ctx, Object.fromEntries(req.nextUrl.searchParams));
  return new Response(csv, {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="realy-payments-${new Date().toISOString().slice(0, 10)}.csv"`, "cache-control": "no-store" },
  });
});
