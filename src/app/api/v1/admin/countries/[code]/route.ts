import { body, route } from "@/server/core/http";
import { updateCountry, updateCountryInput } from "@/server/modules/globalization/service";

export const PATCH = route<{ code: string }>({ auth: "required" }, async ({ req, ctx }, { code }) => updateCountry(ctx, code.toUpperCase(), await body(req, updateCountryInput)));
