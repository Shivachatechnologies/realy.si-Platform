import "server-only";
import type { RequestContext } from "@/server/core/context";
import { fromMinor } from "@/server/modules/finance/common";
import { listCounterparties, listTaxRates } from "@/server/modules/finance/setup";
import type { DocValues, TaxRateOption } from "./document-form";

/** Customers and tax rates for the invoice / estimate editors. */
export async function documentOptions(ctx: RequestContext, organizationId: string, companyId: string, inclusiveLabel: string) {
  const [customers, rates] = await Promise.all([listCounterparties(ctx, organizationId, companyId, "CUSTOMER"), listTaxRates(ctx, organizationId, companyId)]);
  return {
    customers: customers.map((c) => ({ value: c.id, label: c.name })),
    taxRates: rates.map<TaxRateOption>((r) => ({ value: r.id, label: `${r.name} (${r.rateBps / 100}%${r.inclusive ? `, ${inclusiveLabel}` : ""})`, rateBps: r.rateBps, inclusive: r.inclusive })),
  };
}

/** Stored lines → editor values. */
export function linesToValues(lines: { description: string; quantityMilli: number; unitPriceMinor: bigint; discountBps: number; taxRateId: string | null }[], currency: string): DocValues["lines"] {
  return lines.map((l) => ({ description: l.description, quantity: String(l.quantityMilli / 1000), unitPrice: fromMinor(l.unitPriceMinor, currency), discount: l.discountBps ? String(l.discountBps / 100) : "", taxRateId: l.taxRateId ?? "" }));
}
