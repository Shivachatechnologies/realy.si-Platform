import { body, route } from "@/server/core/http";
import { updateRegion, updateRegionInput } from "@/server/modules/globalization/service";

export const PATCH = route<{ code: string }>({ auth: "required" }, async ({ req, ctx }, { code }) => updateRegion(ctx, code.toUpperCase(), await body(req, updateRegionInput)));
