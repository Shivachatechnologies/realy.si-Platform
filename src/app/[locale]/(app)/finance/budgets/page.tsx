import type { Metadata } from "next";
import { Card, CardHeader } from "@/components/ui/card";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { txnOptions } from "@/components/finance/options";
import { financePage } from "@/components/finance/page-context";
import { ActionButton, FormDialog, ResourceForm, type FieldSpec } from "@/components/finance/ui";
import { Empty, Kpi } from "@/components/finance/widgets";
import { getT } from "@/i18n/server";
import { addDays, addMonths, dayString, fromMinor, monthStart, todayUtc } from "@/server/modules/finance/common";
import { budgetVsActual } from "@/server/modules/finance/transactions";
import { cn } from "@/lib/utils";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("finance.tabs.budgets") };
}

export default async function BudgetsPage() {
  const p = await financePage("budgets");
  if (p.blocked) return p.blocked;
  const { t, viewer, org, company, money, base, day } = p;
  const [budgets, options] = await Promise.all([budgetVsActual(viewer.ctx, org.id, company.id), txnOptions(viewer.ctx, org.id, company.id)]);
  const today = todayUtc();
  const current = budgets.filter((b) => b.periodStart <= today && b.periodEnd >= today);
  const fields: FieldSpec[] = [
    { name: "name", label: t("finance.fields.name"), required: true, maxLength: 120 },
    { name: "amount", label: t("finance.fields.amount"), type: "amount", required: true },
    { name: "categoryId", label: t("finance.fields.category"), type: "select", emptyLabel: t("finance.budgets.allCategories"), options: options.categories.filter((c) => c.kind === "EXPENSE") },
    { name: "departmentId", label: t("finance.fields.costCenter"), type: "select", emptyLabel: t("finance.budgets.allCostCenters"), options: options.costCenters },
    { name: "periodStart", label: t("finance.budgets.periodStart"), type: "date", required: true },
    { name: "periodEnd", label: t("finance.budgets.periodEnd"), type: "date", required: true },
  ];
  const ms = monthStart(today);
  return p.frame(
    <>
      <div className="grid gap-3 sm:grid-cols-3">
        <Kpi label={t("finance.budgets.currentBudget")} value={money(current.reduce((s, b) => s + b.amountMinor, 0n))} />
        <Kpi label={t("finance.budgets.currentActual")} value={money(current.reduce((s, b) => s + b.actualMinor, 0n))} />
        <Kpi label={t("finance.budgets.overBudget")} value={current.filter((b) => b.actualMinor > b.amountMinor).length} tone={current.some((b) => b.actualMinor > b.amountMinor) ? "danger" : undefined} />
      </div>
      {p.canManage ? (
        <Card>
          <details>
            <summary className="cursor-pointer px-4 py-3 text-sm font-medium">{t("finance.budgets.new")}</summary>
            <div className="border-t p-4">
              <ResourceForm endpoint={`${base}/budgets`} fields={fields} initial={{ periodStart: dayString(ms), periodEnd: dayString(addDays(addMonths(ms, 1), -1)) }} submitLabel={t("finance.budgets.new")} />
            </div>
          </details>
        </Card>
      ) : null}
      <Card>
        <CardHeader title={t("finance.budgets.title")} description={t("finance.budgets.hint")} />
        {!budgets.length ? (
          <Empty>{t("finance.budgets.empty")}</Empty>
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>{t("finance.fields.name")}</Th>
                <Th>{t("finance.budgets.scope")}</Th>
                <Th>{t("finance.budgets.period")}</Th>
                <Th className="text-end">{t("finance.budgets.budget")}</Th>
                <Th className="text-end">{t("finance.budgets.actual")}</Th>
                <Th className="min-w-40">{t("finance.budgets.used")}</Th>
                <Th>
                  <span className="sr-only">{t("common.actions")}</span>
                </Th>
              </Tr>
            </THead>
            <TBody>
              {budgets.map((b) => (
                <Tr key={b.id}>
                  <Td className="font-medium">{b.name}</Td>
                  <Td className="text-muted-foreground">{[b.category?.name ?? t("finance.budgets.allCategories"), b.department?.name].filter(Boolean).join(" · ")}</Td>
                  <Td className="whitespace-nowrap">
                    {day(b.periodStart)} – {day(b.periodEnd)}
                  </Td>
                  <Td className="text-end tabular-nums">{money(b.amountMinor, b.currency)}</Td>
                  <Td className={cn("text-end tabular-nums", b.actualMinor > b.amountMinor && "text-danger")}>{money(b.actualMinor, b.currency)}</Td>
                  <Td>
                    <div className="flex items-center gap-2">
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={Math.round(b.usedPct)} aria-valuemin={0} aria-valuemax={100}>
                        <div className={cn("h-full", b.usedPct > 100 ? "bg-danger" : b.usedPct > 80 ? "bg-warning" : "bg-success")} style={{ width: `${Math.min(b.usedPct, 100)}%` }} />
                      </div>
                      <span className="w-12 text-end text-xs tabular-nums">{Math.round(b.usedPct)}%</span>
                    </div>
                  </Td>
                  <Td>
                    {p.canManage ? (
                      <div className="flex justify-end gap-1">
                        <FormDialog trigger={t("finance.edit")} title={b.name}>
                          <ResourceForm
                            endpoint={`${base}/budgets/${b.id}`}
                            method="PATCH"
                            fields={fields}
                            initial={{ name: b.name, amount: fromMinor(b.amountMinor, b.currency), categoryId: b.categoryId ?? "", departmentId: b.departmentId ?? "", periodStart: dayString(b.periodStart), periodEnd: dayString(b.periodEnd) }}
                            submitLabel={t("common.save")}
                          />
                        </FormDialog>
                        <ActionButton endpoint={`${base}/budgets/${b.id}`} method="DELETE" label={t("finance.delete")} variant="ghost" confirm={t("finance.budgets.confirmDelete")} />
                      </div>
                    ) : null}
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </>,
  );
}
