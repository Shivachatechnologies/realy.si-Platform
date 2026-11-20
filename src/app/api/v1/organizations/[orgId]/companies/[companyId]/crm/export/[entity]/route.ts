import { route } from "@/server/core/http";
import { AppError } from "@/server/core/errors";
import { CSV_ENTITIES, exportCsv, type CsvEntity } from "@/server/modules/crm/csv";

type P = { orgId: string; companyId: string; entity: string };

/** GET CSV of leads | contacts | accounts | deals, filtered by the same query parameters as the list pages. */
export const GET = route<P>({ auth: "required" }, async ({ req, ctx }, { orgId, companyId, entity }) => {
  if (!(CSV_ENTITIES as readonly string[]).includes(entity)) throw new AppError("not_found", "Export not found");
  const csv = await exportCsv(ctx, orgId, companyId, entity as CsvEntity, Object.fromEntries(req.nextUrl.searchParams));
  const date = new Date().toISOString().slice(0, 10);
  return new Response("\uFEFF" + csv, {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${entity}-${date}.csv"`, "cache-control": "private, no-store" },
  });
});
