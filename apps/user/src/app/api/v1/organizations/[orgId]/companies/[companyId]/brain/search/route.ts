import { route } from "@/server/core/http";
import { searchDocuments } from "@/server/modules/brain/service";

export const GET = route<{ orgId: string; companyId: string }>({ auth: "required" }, async ({ req, ctx }, { orgId, companyId }) =>
  searchDocuments(ctx, orgId, companyId, Object.fromEntries(req.nextUrl.searchParams)),
);
