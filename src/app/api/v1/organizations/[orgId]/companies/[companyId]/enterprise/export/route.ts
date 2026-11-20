import { LIMITS_EXPORT } from "@/server/modules/enterprise/limits";
import { route } from "@/server/core/http";
import { exportCompanyData } from "@/server/modules/enterprise/data";

type P = { orgId: string; companyId: string };

/** Streams the company's data as a JSON download (organizations.manage). */
export const GET = route<P>(
  {
    auth: "required",
    name: "GET /organizations/:orgId/companies/:companyId/enterprise/export",
    rateLimits: LIMITS_EXPORT,
  },
  async ({ ctx }, { orgId, companyId }) => {
    const { stream, filename } = await exportCompanyData(ctx, orgId, companyId);
    return new Response(stream, {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="${filename}"`,
        "cache-control": "no-store",
      },
    });
  },
);
