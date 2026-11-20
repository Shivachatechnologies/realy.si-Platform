import type { Metadata } from "next";
import Link from "next/link";
import { Download, Paperclip } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { financePage } from "@/components/finance/page-context";
import { txnOptions } from "@/components/finance/options";
import { ImportCsv, TransactionForm } from "@/components/finance/transaction-form";
import { Empty, Kpi, Pager, SortLink, StatusBadge, withParams } from "@/components/finance/widgets";
import { getT } from "@/i18n/server";
import { listTransactions, parseTxnFilters, TXN_TYPES } from "@/server/modules/finance/transactions";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("finance.tabs.transactions") };
}

const TYPE_TONE = { INCOME: "success", EXPENSE: "danger", TRANSFER: "neutral" } as const;

export default async function TransactionsPage({ searchParams }: PageProps<"/[locale]/finance/transactions">) {
  const p = await financePage("transactions");
  if (p.blocked) return p.blocked;
  const { t, locale, viewer, org, company, money, base, day } = p;
  const params = await searchParams;
  const f = parseTxnFilters(params);
  const [list, options] = await Promise.all([listTransactions(viewer.ctx, org.id, company.id, f), txnOptions(viewer.ctx, org.id, company.id)]);
  const path = `/${locale}/finance/transactions`;
  const filtered = !!(f.q || f.type || f.financeAccountId || f.categoryId || f.accountId || f.departmentId || f.from || f.to);
  const exportHref = withParams(`${base}/transactions/export`, params, { page: undefined, sort: undefined, dir: undefined });

  return p.frame(
    <>
      <div className="grid gap-3 sm:grid-cols-3">
        <Kpi label={t("finance.transactions.totalIncome")} value={money(list.totals.INCOME)} />
        <Kpi label={t("finance.transactions.totalExpense")} value={money(list.totals.EXPENSE)} />
        <Kpi label={t("finance.transactions.net")} value={money(list.totals.INCOME - list.totals.EXPENSE)} tone={list.totals.INCOME < list.totals.EXPENSE ? "danger" : undefined} hint={filtered ? t("finance.filteredTotals") : undefined} />
      </div>
      {p.canManage ? (
        <Card>
          <details>
            <summary className="cursor-pointer px-4 py-3 text-sm font-medium">{t("finance.transactions.add")}</summary>
            <div className="border-t p-4">
              <TransactionForm base={base} locale={locale} options={options} />
            </div>
          </details>
          <details className="border-t">
            <summary className="cursor-pointer px-4 py-3 text-sm font-medium">{t("finance.transactions.import")}</summary>
            <div className="border-t p-4">
              <ImportCsv base={base} accounts={options.accounts} />
            </div>
          </details>
        </Card>
      ) : null}
      <Card>
        <CardHeader
          title={t("finance.tabs.transactions")}
          description={t("finance.count", { count: list.total })}
          actions={
            <Button asChild size="sm" variant="secondary">
              <a href={exportHref}>
                <Download aria-hidden />
                {t("finance.exportCsv")}
              </a>
            </Button>
          }
        />
        <form action={path} className="grid gap-2 border-b p-3 sm:grid-cols-4 lg:grid-cols-[minmax(0,1fr)_8rem_10rem_10rem_10rem_10rem_9rem_9rem_auto]">
          <Input name="q" type="search" defaultValue={f.q ?? ""} maxLength={200} placeholder={t("finance.transactions.search")} aria-label={t("finance.search")} />
          <Select name="type" defaultValue={f.type ?? ""} aria-label={t("finance.transactions.type")}>
            <option value="">{t("finance.allTypes")}</option>
            {TXN_TYPES.map((x) => (
              <option key={x} value={x}>
                {t(`finance.transactions.types.${x}`)}
              </option>
            ))}
          </Select>
          <Select name="account" defaultValue={f.financeAccountId ?? ""} aria-label={t("finance.fields.account")}>
            <option value="">{t("finance.allAccounts")}</option>
            {options.accounts.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
          <Select name="category" defaultValue={f.categoryId ?? ""} aria-label={t("finance.fields.category")}>
            <option value="">{t("finance.allCategories")}</option>
            {options.categories.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
          <Select name="counterparty" defaultValue={f.accountId ?? ""} aria-label={t("finance.fields.counterparty")}>
            <option value="">{t("finance.allCounterparties")}</option>
            {options.counterparties.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
          <Select name="costCenter" defaultValue={f.departmentId ?? ""} aria-label={t("finance.fields.costCenter")}>
            <option value="">{t("finance.allCostCenters")}</option>
            {options.costCenters.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
          <Input name="from" type="date" defaultValue={f.from ?? ""} aria-label={t("finance.range.from")} />
          <Input name="to" type="date" defaultValue={f.to ?? ""} aria-label={t("finance.range.to")} />
          <div className="flex items-center gap-2">
            <Button type="submit" variant="secondary">
              {t("finance.apply")}
            </Button>
            {filtered ? (
              <Link href={path} className="text-xs text-muted-foreground hover:underline">
                {t("finance.clear")}
              </Link>
            ) : null}
          </div>
        </form>
        {list.rows.length === 0 ? (
          <Empty>{filtered ? t("common.noResults") : t("finance.transactions.empty")}</Empty>
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>
                  <SortLink path={path} params={params} field="date" current={f.sort} dir={f.dir}>
                    {t("finance.fields.date")}
                  </SortLink>
                </Th>
                <Th>
                  <SortLink path={path} params={params} field="description" current={f.sort} dir={f.dir}>
                    {t("finance.fields.description")}
                  </SortLink>
                </Th>
                <Th>{t("finance.fields.account")}</Th>
                <Th>{t("finance.fields.category")}</Th>
                <Th>{t("finance.fields.counterparty")}</Th>
                <Th>{t("finance.fields.costCenter")}</Th>
                <Th className="text-end">
                  <SortLink path={path} params={params} field="amount" current={f.sort} dir={f.dir}>
                    {t("finance.fields.amount")}
                  </SortLink>
                </Th>
              </Tr>
            </THead>
            <TBody>
              {list.rows.map((r) => (
                <Tr key={r.id}>
                  <Td className="whitespace-nowrap">{day(r.date)}</Td>
                  <Td>
                    <div className="flex items-center gap-2">
                      <StatusBadge tone={TYPE_TONE[r.type]}>{t(`finance.transactions.types.${r.type}`)}</StatusBadge>
                      <Link href={`/${locale}/finance/transactions/${r.id}`} className="font-medium hover:underline">
                        {r.description}
                      </Link>
                      {r.attachment ? <Paperclip className="size-3.5 text-muted-foreground" aria-label={t("finance.transactions.attachment")} /> : null}
                      {r.reconciledAt ? <StatusBadge tone="success">{t("finance.transactions.reconciled")}</StatusBadge> : null}
                    </div>
                    {r.reference ? <span className="text-xs text-muted-foreground">{r.reference}</span> : null}
                  </Td>
                  <Td className="text-muted-foreground">{r.type === "TRANSFER" ? `${r.financeAccount.name} → ${r.toAccount?.name ?? ""}` : r.financeAccount.name}</Td>
                  <Td className="text-muted-foreground">{r.category?.name ?? "—"}</Td>
                  <Td className="text-muted-foreground">{r.account?.name ?? "—"}</Td>
                  <Td className="text-muted-foreground">{r.department?.name ?? "—"}</Td>
                  <Td className={`text-end font-medium whitespace-nowrap tabular-nums ${r.type === "INCOME" ? "text-success" : r.type === "EXPENSE" ? "text-danger" : ""}`}>
                    {r.type === "EXPENSE" ? "−" : r.type === "INCOME" ? "+" : ""}
                    {money(r.amountMinor, r.currency)}
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
        <Pager path={path} params={params} page={f.page} pages={list.pages} labels={{ previous: t("common.previous"), next: t("common.next"), page: t("finance.pageOf", { page: f.page, pages: list.pages }) }} />
      </Card>
    </>,
  );
}
