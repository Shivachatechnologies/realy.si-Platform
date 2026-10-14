import { body, route } from "@/server/core/http";
import { quote, quoteInput } from "@/server/modules/billing/service";

export const POST = route<{ orgId: string }>({ auth: "required" }, async ({ req, ctx }, { orgId }) => quote(ctx, orgId, await body(req, quoteInput)));
