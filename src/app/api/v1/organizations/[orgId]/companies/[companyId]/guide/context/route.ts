import { route } from "@/server/core/http";
import { guideContext } from "@/server/modules/guide/service";

type P = { orgId: string; companyId: string };

/** GET ?path=/en-US/crm — the guide's context for the page at that browser path. */
export const GET = route<P>({ auth: "required" }, async ({ req, ctx }, { orgId, companyId }) =>
  guideContext(ctx, orgId, companyId, (req.nextUrl.searchParams.get("path") ?? "").slice(0, 400)),
);
