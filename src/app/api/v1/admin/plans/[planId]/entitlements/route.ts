import { body, route } from "@/server/core/http";
import { entitlementInput, setEntitlement } from "@/server/modules/pricing/service";

export const PUT = route<{ planId: string }>({ auth: "required" }, async ({ req, ctx }, { planId }) => setEntitlement(ctx, planId, await body(req, entitlementInput)));
