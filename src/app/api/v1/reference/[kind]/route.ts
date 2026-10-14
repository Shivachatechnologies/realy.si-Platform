import { LIMITS } from "@/server/core/limits";
import { route } from "@/server/core/http";
import { notFound } from "@/server/core/errors";
import { listCountries, listCurrencies, listLocales, listRegions } from "@/server/modules/globalization/service";

const loaders = { countries: listCountries, regions: listRegions, currencies: listCurrencies, locales: listLocales } as const;

export const GET = route<{ kind: string }>({ auth: "none", name: "GET /reference/:kind", rateLimits: LIMITS.publicRead }, async (_args, { kind }) => {
  const load = loaders[kind as keyof typeof loaders];
  if (!load) throw notFound("Reference data");
  return { data: await load() };
});
