import type { Metadata } from "next";
import { Card, CardHeader } from "@/components/ui/card";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { documentOptions } from "@/components/finance/billing-data";
import { DocumentForm, type LineValue } from "@/components/finance/document-form";
import { txnOptions } from "@/components/finance/options";
import { financePage } from "@/components/finance/page-context";
import { ActionButton, FormDialog, ResourceForm, type FieldSpec } from "@/components/finance/ui";
import { Empty, Kpi, StatusBadge } from "@/components/finance/widgets";
import { getT } from "@/i18n/server";
import { db } from "@/server/core/db";
import { recurringRevenue } from "@/server/modules/finance/analytics";
import { listRecurringInvoices } from "@/server/modules/finance/billing";
import { dayString, fromMinor, PER_MONTH } from "@/server/modules/finance/common";
import { FREQUENCIES, listRecurringExpenses } from "@/server/modules/finance/transactions";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("finance.tabs.recurring") };
}

export default async function RecurringPage() {
  const p = await financePage("recurring");
  if (p.blocked) return p.blocked;
  const { t, locale, viewer, org, company, money, base, day } = p;
  const [expenses, invoices, rr, options, docOpts] = await Promise.all([
    listRecurringExpenses(viewer.ctx, org.id, company.id),
    listRecurringInvoices(viewer.ctx, org.id, company.id),
    recurringRevenue(db(), company.id),
    txnOptions(viewer.ctx, org.id, company.id),
    documentOptions(viewer.ctx, org.id, company.id, t("finance.tax.inclusive")),
  ]);
  const monthlyCost = expenses.filter((e) => e.active).reduce((s, e) => s + BigInt(Math.round(Number(e.amountMinor) * PER_MONTH[e.frequency])), 0n);
  const freq = FREQUENCIES.map((x) => ({ value: x, label: t(`finance.frequency.${x}`) }));
  const expenseFields: FieldSpec[] = [
    { name: "name", label: t("finance.fields.name"), required: true, maxLength: 200 },
    { name: "amount", label: t("finance.fields.amount"), type: "amount", required: true },
    { name: "frequency", label: t("finance.recurring.frequency"), type: "select", options: freq },
    { name: "financeAccountId", label: t("finance.fields.account"), type: "select", required: true, options: options.accounts },
    { name: "categoryId", label: t("finance.fields.category"), type: "select", emptyLabel: t("finance.fields.uncategorized"), options: options.categories.filter((c) => c.kind === "EXPENSE") },
    { name: "accountId", label: t("finance.fields.vendor"), type: "select", emptyLabel: t("common.none"), options: options.counterparties.filter((c) => c.type !== "CUSTOMER" && c.type !== "PROSPECT") },
    { name: "departmentId", label: t("finance.fields.costCenter"), type: "select", emptyLabel: t("common.none"), options: options.costCenters },
    { name: "nextRunDate", label: t("finance.recurring.nextRun"), type: "date", required: true },
    { name: "endDate", label: t("finance.recurring.endDate"), type: "date" },
  ];

  return p.frame(
    <>
      <div className="grid gap-3 sm:grid-cols-3">
        <Kpi label={t("finance.metrics.mrr")} value={money(rr.mrr)} />
        <Kpi label={t("finance.metrics.arr")} value={money(rr.arr)} />
        <Kpi label={t("finance.recurring.monthlyCost")} value={money(monthlyCost)} />
      </div>

      <Card>
        <CardHeader title={t("finance.recurring.invoicesTitle")} description={t("finance.recurring.invoicesHint")} />
        {p.canManage ? (
          <details className="border-b">
            <summary className="cursor-pointer px-4 py-3 text-sm font-medium">{t("finance.recurring.newInvoice")}</summary>
            <div className="border-t p-4">
              {docOpts.customers.length ? <DocumentForm kind="recurring" base={base} locale={locale} currency={company.baseCurrency} customers={docOpts.customers} taxRates={docOpts.taxRates} /> : <p className="text-sm text-muted-foreground">{t("finance.recurring.needCustomer")}</p>}
            </div>
          </details>
        ) : null}
        {!invoices.length ? (
          <Empty>{t("finance.recurring.invoicesEmpty")}</Empty>
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>{t("finance.fields.name")}</Th>
                <Th>{t("finance.fields.customer")}</Th>
                <Th>{t("finance.recurring.frequency")}</Th>
                <Th>{t("finance.recurring.nextIssue")}</Th>
                <Th className="text-end">{t("finance.recurring.netPerIssue")}</Th>
                <Th className="text-end">{t("finance.recurring.issued")}</Th>
                <Th>
                  <span className="sr-only">{t("common.actions")}</span>
                </Th>
              </Tr>
            </THead>
            <TBody>
              {invoices.map((r) => (
                <Tr key={r.id} className={r.active ? undefined : "opacity-60"}>
                  <Td className="font-medium">
                    {r.name} {!r.active ? <StatusBadge tone="neutral">{t("finance.recurring.paused")}</StatusBadge> : null}
                  </Td>
                  <Td>{r.account.name}</Td>
                  <Td>{t(`finance.frequency.${r.frequency}`)}</Td>
                  <Td className="whitespace-nowrap">{day(r.nextIssueDate)}</Td>
                  <Td className="text-end tabular-nums">{money(r.netMinor, r.currency)}</Td>
                  <Td className="text-end tabular-nums">{r._count.invoices}</Td>
                  <Td>
                    {p.canManage ? (
                      <div className="flex flex-wrap justify-end gap-1">
                        {r.active ? <ActionButton endpoint={`${base}/recurring-invoices/${r.id}/run`} label={t("finance.recurring.runNow")} confirm={t("finance.recurring.confirmRun")} redirectTo={`/${locale}/finance/invoices/:id`} /> : null}
                        <FormDialog trigger={t("finance.edit")} title={r.name}>
                          <DocumentForm
                            kind="recurring"
                            id={r.id}
                            base={base}
                            locale={locale}
                            currency={r.currency}
                            customers={docOpts.customers}
                            taxRates={docOpts.taxRates}
                            initial={{
                              name: r.name,
                              accountId: r.accountId,
                              frequency: r.frequency,
                              nextIssueDate: dayString(r.nextIssueDate),
                              endDate: r.endDate ? dayString(r.endDate) : "",
                              dueDays: String(r.dueDays),
                              discount: r.discountBps ? String(r.discountBps / 100) : "",
                              notes: r.notes ?? "",
                              lines: (r.lines as unknown as { description: string; quantity: string; unitPrice: string; discount?: number | string | null; taxRateId?: string | null }[]).map<LineValue>((l) => ({ description: l.description, quantity: String(l.quantity), unitPrice: String(l.unitPrice), discount: l.discount ? String(l.discount) : "", taxRateId: l.taxRateId ?? "" })),
                            }}
                          />
                        </FormDialog>
                        <ActionButton endpoint={`${base}/recurring-invoices/${r.id}`} method="PATCH" body={{ active: !r.active }} label={r.active ? t("finance.recurring.pause") : t("finance.recurring.resume")} variant="ghost" />
                        <ActionButton endpoint={`${base}/recurring-invoices/${r.id}`} method="DELETE" label={t("finance.delete")} variant="ghost" confirm={t("finance.recurring.confirmDelete")} />
                      </div>
                    ) : null}
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Card>

      <Card>
        <CardHeader title={t("finance.recurring.expensesTitle")} description={t("finance.recurring.expensesHint")} />
        {p.canManage ? (
          <details className="border-b">
            <summary className="cursor-pointer px-4 py-3 text-sm font-medium">{t("finance.recurring.newExpense")}</summary>
            <div className="border-t p-4">
              {options.accounts.length ? (
                <ResourceForm endpoint={`${base}/recurring-expenses`} fields={expenseFields} initial={{ frequency: "MONTHLY", financeAccountId: options.accounts[0]?.value ?? "", nextRunDate: dayString(new Date()) }} submitLabel={t("finance.recurring.newExpense")} />
              ) : (
                <p className="text-sm text-muted-foreground">{t("finance.transactions.needAccount")}</p>
              )}
            </div>
          </details>
        ) : null}
        {!expenses.length ? (
          <Empty>{t("finance.recurring.expensesEmpty")}</Empty>
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>{t("finance.fields.name")}</Th>
                <Th>{t("finance.fields.vendor")}</Th>
                <Th>{t("finance.fields.category")}</Th>
                <Th>{t("finance.recurring.frequency")}</Th>
                <Th>{t("finance.recurring.nextRun")}</Th>
                <Th className="text-end">{t("finance.fields.amount")}</Th>
                <Th>
                  <span className="sr-only">{t("common.actions")}</span>
                </Th>
              </Tr>
            </THead>
            <TBody>
              {expenses.map((e) => (
                <Tr key={e.id} className={e.active ? undefined : "opacity-60"}>
                  <Td className="font-medium">
                    {e.name} {!e.active ? <StatusBadge tone="neutral">{t("finance.recurring.paused")}</StatusBadge> : null}
                    <span className="block text-xs font-normal text-muted-foreground">{e.financeAccount.name}</span>
                  </Td>
                  <Td>{e.account?.name ?? "—"}</Td>
                  <Td>{e.category?.name ?? "—"}</Td>
                  <Td>{t(`finance.frequency.${e.frequency}`)}</Td>
                  <Td className="whitespace-nowrap">{day(e.nextRunDate)}</Td>
                  <Td className="text-end tabular-nums">{money(e.amountMinor, e.currency)}</Td>
                  <Td>
                    {p.canManage ? (
                      <div className="flex flex-wrap justify-end gap-1">
                        <FormDialog trigger={t("finance.edit")} title={e.name}>
                          <ResourceForm
                            endpoint={`${base}/recurring-expenses/${e.id}`}
                            method="PATCH"
                            fields={expenseFields}
                            initial={{ name: e.name, amount: fromMinor(e.amountMinor, e.currency), frequency: e.frequency, financeAccountId: e.financeAccountId, categoryId: e.categoryId ?? "", accountId: e.accountId ?? "", departmentId: e.departmentId ?? "", nextRunDate: dayString(e.nextRunDate), endDate: e.endDate ? dayString(e.endDate) : "" }}
                            submitLabel={t("common.save")}
                          />
                        </FormDialog>
                        <ActionButton endpoint={`${base}/recurring-expenses/${e.id}`} method="PATCH" body={{ active: !e.active }} label={e.active ? t("finance.recurring.pause") : t("finance.recurring.resume")} variant="ghost" />
                        <ActionButton endpoint={`${base}/recurring-expenses/${e.id}`} method="DELETE" label={t("finance.delete")} variant="ghost" confirm={t("finance.recurring.confirmDelete")} />
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
