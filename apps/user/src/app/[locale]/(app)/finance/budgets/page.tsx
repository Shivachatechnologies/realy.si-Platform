import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { txnOptions } from "@/components/finance/options";
import { financePage } from "@/components/finance/page-context";
import { ActionButton, FormDialog, ResourceForm, type FieldSpec } from "@/components/finance/ui";
import { Empty, Kpi, UsageBar } from "@/components/finance/widgets";
import { getT } from "@/i18n/server";
import { addDays, addMonths, dayString, fromMinor, monthStart, todayUtc } from "@/server/modules/finance/common";
import { budgetVsActual } from "@/server/modules/finance/transactions";
import { departmentBudgets, parseBudgetWindow } from "@/server/modules/finance/budgets";
import { cn } from "@/lib/utils";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("finance.tabs.budgets") };
}

export default async function BudgetsPage({ searchParams }: PageProps<"/[locale]/finance/budgets">) {
  const p = await financePage("budgets");
  if (p.blocked) return p.blocked;
  const { t, locale, viewer, org, company, money, base, day } = p;
  const w = parseBudgetWindow(await searchParams);
  const [budgets, options, deps] = await Promise.all([budgetVsActual(viewer.ctx, org.id, company.id), txnOptions(viewer.ctx, org.id, company.id), departmentBudgets(viewer.ctx, org.id, company.id, w)]);
  const path = `/${locale}/finance/budgets`;
  const windowQuery = `period=${w.period}&at=${w.at}`;
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
      <Card>
        <CardHeader title={t("finance.budgets.departmentsTitle", { period: w.label })} description={t("finance.budgets.departmentsHint")} />
        <form action={path} className="flex flex-wrap items-end gap-2 border-b p-3">
          <Select name="period" defaultValue={w.period} aria-label={t("finance.budgets.period")} className="h-8 w-36">
            <option value="month">{t("finance.budgets.periods.month")}</option>
            <option value="quarter">{t("finance.budgets.periods.quarter")}</option>
          </Select>
          <Input name="at" type="month" defaultValue={w.at} aria-label={t("finance.budgets.period")} className="h-8 w-40" />
          <Button type="submit" size="sm" variant="secondary">
            {t("finance.apply")}
          </Button>
          <span className="ms-auto text-sm text-muted-foreground">
            {t("finance.budgets.totalLine", { actual: money(deps.totalActual), budget: money(deps.totalBudget) })}
            {deps.usedPct !== null ? ` · ${Math.round(deps.usedPct)}%` : ""}
          </span>
        </form>
        {!deps.rows.length ? (
          <Empty>{t("finance.budgets.departmentsEmpty")}</Empty>
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>{t("finance.fields.costCenter")}</Th>
                <Th>{t("finance.budgets.owner")}</Th>
                <Th className="text-end">{t("finance.budgets.budget")}</Th>
                <Th className="text-end">{t("finance.budgets.expensesPart")}</Th>
                <Th className="text-end">{t("finance.budgets.billsPart")}</Th>
                <Th className="text-end">{t("finance.budgets.actual")}</Th>
                <Th className="min-w-40">{t("finance.budgets.used")}</Th>
              </Tr>
            </THead>
            <TBody>
              {deps.rows.map((d) => (
                <Tr key={d.id}>
                  <Td>
                    <Link href={`${path}/${d.id}?${windowQuery}`} className="font-medium hover:underline">
                      {d.costCenterCode ? `${d.costCenterCode} · ${d.name}` : d.name}
                    </Link>
                  </Td>
                  <Td className="text-muted-foreground">{d.headName ?? "—"}</Td>
                  <Td className="text-end tabular-nums">{d.budgetMinor ? money(d.budgetMinor) : "—"}</Td>
                  <Td className="text-end tabular-nums">{money(d.transactionsMinor)}</Td>
                  <Td className="text-end tabular-nums">{money(d.billsMinor)}</Td>
                  <Td className={cn("text-end font-medium tabular-nums", d.usedPct !== null && d.usedPct > 100 && "text-danger")}>{money(d.totalMinor)}</Td>
                  <Td>
                    <UsageBar pct={d.usedPct} />
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
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
        <CardHeader title={t("finance.budgets.title")} description={t("finance.budgets.hintAccrual")} />
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
