import { route } from "@/server/core/http";
import { listPeople } from "@/server/modules/work/shared";

type P = { orgId: string; companyId: string };

export const GET = route<P>({ auth: "required" }, async ({ req, ctx }, { orgId, companyId }) => ({ data: await listPeople(ctx, orgId, companyId, req.nextUrl.searchParams.get("area") === "operations" ? "operations.read" : "projects.read") }));
