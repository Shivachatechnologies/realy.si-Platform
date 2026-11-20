import "server-only";
import type { RequestContext } from "@/server/core/context";
import { db } from "@/server/core/db";
import { listCategories, listCostCenters, listFinanceAccounts, listTaxRates } from "@/server/modules/finance/setup";
import type { TxnOptions } from "./transaction-form";

/** Select options for transaction-like forms (active records only). */
export async function txnOptions(ctx: RequestContext, organizationId: string, companyId: string): Promise<TxnOptions> {
  const [accounts, categories, costCenters, parties] = await Promise.all([
    listFinanceAccounts(ctx, organizationId, companyId),
    listCategories(ctx, organizationId, companyId),
    listCostCenters(ctx, organizationId, companyId),
    db().account.findMany({ where: { organizationId, companyId, archivedAt: null }, orderBy: { name: "asc" }, select: { id: true, name: true, type: true }, take: 2000 }),
  ]);
  const projects = await projectOptions(organizationId, companyId);
  return {
    accounts: accounts.map((a) => ({ value: a.id, label: a.name })),
    categories: categories.map((c) => ({ value: c.id, label: c.name, kind: c.kind })),
    costCenters: costCenters.map((d) => ({ value: d.id, label: d.costCenterCode ? `${d.costCenterCode} · ${d.name}` : d.name })),
    counterparties: parties.map((p) => ({ value: p.id, label: p.name, type: p.type })),
    projects,
  };
}

export async function taxOptions(ctx: RequestContext, organizationId: string, companyId: string, inclusiveLabel: string) {
  const rates = await listTaxRates(ctx, organizationId, companyId);
  return rates.map((r) => ({ value: r.id, label: `${r.name} (${r.rateBps / 100}%${r.inclusive ? `, ${inclusiveLabel}` : ""})` }));
}

/** Active projects of the company for project-costing pickers (callers hold finance.read). */
export async function projectOptions(organizationId: string, companyId: string) {
  const rows = await db().project.findMany({ where: { organizationId, companyId, archivedAt: null }, orderBy: { name: "asc" }, select: { id: true, name: true }, take: 1000 });
  return rows.map((p) => ({ value: p.id, label: p.name }));
}
