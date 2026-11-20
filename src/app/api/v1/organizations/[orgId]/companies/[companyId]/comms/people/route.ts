import { route } from "@/server/core/http";
import { listPeople } from "@/server/modules/comms/common";

type P = { orgId: string; companyId: string };

export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId }) => ({ data: await listPeople(ctx, orgId, companyId) }));
