import "server-only";
import type { RequestContext } from "@/server/core/context";
import { dayString, fromMinor } from "@/server/modules/finance/common";
import { listCategories, listCostCenters, listCounterparties, listTaxRates } from "@/server/modules/finance/setup";
import type { BillOptions, BillValues } from "./bill-form";
import { projectOptions } from "./options";

/** Vendors, tax rates, expense categories, cost centers and projects for the bill editor. */
export async function billOptions(ctx: RequestContext, organizationId: string, companyId: string, inclusiveLabel: string): Promise<BillOptions> {
  const [vendors, rates, categories, costCenters, projects] = await Promise.all([
    listCounterparties(ctx, organizationId, companyId, "VENDOR"),
    listTaxRates(ctx, organizationId, companyId),
    listCategories(ctx, organizationId, companyId),
    listCostCenters(ctx, organizationId, companyId),
    projectOptions(organizationId, companyId),
  ]);
  return {
    vendors: vendors.map((v) => ({ value: v.id, label: v.name })),
    taxRates: rates.map((r) => ({ value: r.id, label: `${r.name} (${r.rateBps / 100}%${r.inclusive ? `, ${inclusiveLabel}` : ""})`, rateBps: r.rateBps, inclusive: r.inclusive })),
    categories: categories.filter((c) => c.kind === "EXPENSE").map((c) => ({ value: c.id, label: c.name })),
    costCenters: costCenters.map((d) => ({ value: d.id, label: d.costCenterCode ? `${d.costCenterCode} · ${d.name}` : d.name })),
    projects,
  };
}

export function billToValues(b: {
  vendorId: string;
  number: string;
  issueDate: Date;
  dueDate: Date;
  notes: string | null;
  currency: string;
  lines: { description: string; quantityMilli: number; unitPriceMinor: bigint; taxRateId: string | null; categoryId: string | null; departmentId: string | null; projectId: string | null }[];
}): BillValues {
  return {
    vendorId: b.vendorId,
    number: b.number,
    issueDate: dayString(b.issueDate),
    dueDate: dayString(b.dueDate),
    notes: b.notes ?? "",
    lines: b.lines.map((l) => ({ description: l.description, quantity: String(l.quantityMilli / 1000), unitPrice: fromMinor(l.unitPriceMinor, b.currency), taxRateId: l.taxRateId ?? "", categoryId: l.categoryId ?? "", departmentId: l.departmentId ?? "", projectId: l.projectId ?? "" })),
  };
}
