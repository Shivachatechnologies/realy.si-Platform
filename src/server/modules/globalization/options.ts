import { db } from "@/server/core/db";

export interface CountryOption {
  code: string;
  defaultCurrency: string;
  defaultTimezone: string;
  dataRegion: string;
}

/** Country + currency options for company forms (active reference data only). */
export async function companyFormOptions(): Promise<{ countries: CountryOption[]; currencies: string[] }> {
  const [countries, currencies] = await Promise.all([
    db().country.findMany({ where: { status: "ACTIVE" }, include: { region: { select: { dataRegion: true } } } }),
    db().currency.findMany({ where: { enabled: true }, orderBy: { code: "asc" }, select: { code: true } }),
  ]);
  return {
    countries: countries.map((c) => ({ code: c.code, defaultCurrency: c.defaultCurrency, defaultTimezone: c.defaultTimezone, dataRegion: c.region.dataRegion })),
    currencies: currencies.map((c) => c.code),
  };
}
