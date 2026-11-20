import { route } from "@/server/core/http";
import { LIMITS_EXPORT } from "@/server/modules/enterprise/limits";
import { exportAuditCsv, parseAuditFilters } from "@/server/modules/enterprise/insights";

/** CSV download of the filtered audit trail (same filters as /audit). */
export const GET = route<{ orgId: string }>(
  {
    auth: "required",
    name: "GET /organizations/:orgId/enterprise/audit/export",
    rateLimits: LIMITS_EXPORT,
  },
  async ({ req, ctx }, { orgId }) => {
    const stream = await exportAuditCsv(ctx, orgId, parseAuditFilters(Object.fromEntries(req.nextUrl.searchParams)));
    return new Response(stream, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="audit-${new Date().toISOString().slice(0, 10)}.csv"`,
        "cache-control": "no-store",
      },
    });
  },
);
