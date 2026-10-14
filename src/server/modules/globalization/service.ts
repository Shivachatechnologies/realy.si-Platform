import { z } from "zod";
import { db, transaction } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { invalid, notFound } from "@/server/core/errors";
import { writeAudit } from "@/server/modules/audit/service";
import { emitEvent } from "@/server/modules/events/emit";
import { requirePermission } from "@/server/modules/rbac/service";
import { countryChain, regionChain } from "@/server/modules/rbac/scope";

// Reference data is public (no tenant data).
export const listCountries = () =>
  db().country.findMany({ orderBy: { name: "asc" }, include: { taxConfigs: { where: { status: "ACTIVE" } } } });
export const listRegions = () => db().region.findMany({ orderBy: { name: "asc" } });
export const listCurrencies = () => db().currency.findMany({ orderBy: { code: "asc" } });
export const listLocales = () => db().locale.findMany({ orderBy: { tag: "asc" } });

export const updateCountryInput = z.object({
  billingEnabled: z.boolean().optional(),
  status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
  defaultLocale: z.string().max(35).optional(),
  supportedLocales: z.array(z.string().max(35)).max(50).optional(),
  defaultCurrency: z.string().regex(/^[A-Z]{3}$/).optional(),
  supportedCurrencies: z.array(z.string().regex(/^[A-Z]{3}$/)).max(20).optional(),
  paymentMethods: z.array(z.string().regex(/^[a-z_]{2,40}$/)).max(30).optional(),
  reason: z.string().trim().min(3).max(500),
});

/** Update one country's configuration. Requires globalization.manage at COUNTRY → REGION → PLATFORM. */
export async function updateCountry(ctx: RequestContext, code: string, raw: z.input<typeof updateCountryInput>) {
  const { reason, ...patch } = updateCountryInput.parse(raw);
  return transaction(async (tx) => {
    await requirePermission(ctx, "globalization.manage", await countryChain(tx, code), tx);
    const before = await tx.country.findUnique({ where: { code } });
    if (!before) throw notFound(`Country ${code}`);
    const currencies = patch.supportedCurrencies ?? before.supportedCurrencies;
    const defaultCurrency = patch.defaultCurrency ?? before.defaultCurrency;
    if (!currencies.includes(defaultCurrency)) throw invalid("Default currency must be one of the supported currencies");
    const known = await tx.currency.count({ where: { code: { in: currencies } } });
    if (known !== currencies.length) throw invalid("Unknown currency in supportedCurrencies");
    const locales = patch.supportedLocales ?? before.supportedLocales;
    const defaultLocale = patch.defaultLocale ?? before.defaultLocale;
    if (!locales.includes(defaultLocale)) throw invalid("Default locale must be one of the supported locales");
    const after = await tx.country.update({ where: { code }, data: patch });
    await writeAudit(tx, ctx, { category: "ADMIN", action: "globalization.country.updated", resourceType: "country", resourceId: code, oldValue: before, newValue: after, reason });
    await emitEvent(tx, ctx, "globalization.country.updated", { countryCode: code }, { aggregateType: "country", aggregateId: code });
    return after;
  });
}

export const updateRegionInput = z.object({
  status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
  defaultCurrency: z.string().regex(/^[A-Z]{3}$/).optional(),
  defaultLocale: z.string().max(35).optional(),
  timezone: z.string().max(64).optional(),
  reason: z.string().trim().min(3).max(500),
});

export async function updateRegion(ctx: RequestContext, code: string, raw: z.input<typeof updateRegionInput>) {
  const { reason, ...patch } = updateRegionInput.parse(raw);
  return transaction(async (tx) => {
    await requirePermission(ctx, "globalization.manage", regionChain(code), tx);
    const before = await tx.region.findUnique({ where: { code } });
    if (!before) throw notFound(`Region ${code}`);
    const after = await tx.region.update({ where: { code }, data: patch });
    await writeAudit(tx, ctx, { category: "ADMIN", action: "globalization.region.updated", resourceType: "region", resourceId: code, oldValue: before, newValue: after, reason });
    return after;
  });
}
