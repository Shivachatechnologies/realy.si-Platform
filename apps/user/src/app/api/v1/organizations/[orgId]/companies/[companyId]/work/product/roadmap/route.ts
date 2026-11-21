import { route } from "@/server/core/http";
import { getRoadmap } from "@/server/modules/work/product";

type P = { orgId: string; companyId: string };

export const GET = route<P>({ auth: "required" }, async ({ req, ctx }, { orgId, companyId }) => getRoadmap(ctx, orgId, companyId, { start: req.nextUrl.searchParams.get("start") ?? undefined }));
