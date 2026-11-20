import { route } from "@/server/core/http";
import { whatsNext } from "@/server/modules/guide/service";

type P = { orgId: string; companyId: string };

export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId }) => whatsNext(ctx, orgId, companyId));
