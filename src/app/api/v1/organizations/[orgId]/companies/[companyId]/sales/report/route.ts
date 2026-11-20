import { route } from "@/server/core/http";
import { isoDay, toMajor } from "@/server/modules/crm/common";
import { toCsv } from "@/server/modules/crm/csv";
import { conversionMetrics, parseSalesRange, revenueAttribution, salesReportRows } from "@/server/modules/crm/sales";

type P = { orgId: string; companyId: string };

/** GET ?from=&to=&owner=&pipeline=&source=&basis=closed|created&format=csv|json */
export const GET = route<P>({ auth: "required" }, async ({ req, ctx }, { orgId, companyId }) => {
  const q = Object.fromEntries(req.nextUrl.searchParams);
  const r = parseSalesRange(q);
  const basis = q.basis === "created" ? "created" : "closed";
  const rows = await salesReportRows(ctx, orgId, companyId, r, basis);
  if (q.format === "csv") {
    const csv = toCsv(
      ["Deal", "Account", "Pipeline", "Stage", "Status", "Amount", "Currency", "Owner", "Source", "Campaign", "Lost reason", "Created", "Closed", "Expected close"],
      rows.map((d) => [d.name, d.account?.name, d.pipeline.name, d.stage.name, d.status, toMajor(d.amountMinor, d.currency), d.currency, d.ownerName, d.source, d.campaignCode, d.lostReason, isoDay(d.createdAt), isoDay(d.closedAt), isoDay(d.expectedCloseDate)]),
    );
    return new Response("\uFEFF" + csv, {
      headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="sales-report-${isoDay(r.from)}.csv"`, "cache-control": "private, no-store" },
    });
  }
  const [conversion, attribution] = await Promise.all([conversionMetrics(ctx, orgId, companyId, r), revenueAttribution(ctx, orgId, companyId, r)]);
  return { data: rows, conversion, attribution };
});
