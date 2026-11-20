import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { financePage } from "@/components/finance/page-context";
import { Empty, INVOICE_TONE, Kpi, Pager, SortLink, StatusBadge } from "@/components/finance/widgets";
import { getT } from "@/i18n/server";
import { db } from "@/server/core/db";
import { openReceivables, overdueReceivables } from "@/server/modules/finance/analytics";
import { INVOICE_STATUSES, listInvoices, parseInvoiceFilters } from "@/server/modules/finance/billing";
import { listCounterparties } from "@/server/modules/finance/setup";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("finance.tabs.invoices") };
}

export default async function InvoicesPage({ searchParams }: PageProps<"/[locale]/finance/invoices">) {
  const p = await financePage("invoices");
  if (p.blocked) return p.blocked;
  const { t, locale, viewer, org, company, money, day } = p;
  const params = await searchParams;
  const f = parseInvoiceFilters(params);
  const [list, customers, open, overdue, drafts] = await Promise.all([
    listInvoices(viewer.ctx, org.id, company.id, f),
    listCounterparties(viewer.ctx, org.id, company.id, "CUSTOMER"),
    openReceivables(db(), company.id),
    overdueReceivables(db(), company.id),
    db().invoice.count({ where: { companyId: company.id, status: "DRAFT" } }),
  ]);
  const path = `/${locale}/finance/invoices`;
  const filtered = !!(f.q || f.status || f.accountId || f.from || f.to);

  return p.frame(
    <>
      <div className="grid gap-3 sm:grid-cols-3">
        <Kpi label={t("finance.invoices.outstanding")} value={money(open)} />
        <Kpi label={t("finance.metrics.receivablesOverdue")} value={money(overdue)} tone={overdue > 0n ? "warning" : undefined} />
        <Kpi label={t("finance.invoices.drafts")} value={drafts} />
      </div>
      <Card>
        <CardHeader
          title={t("finance.tabs.invoices")}
          description={t("finance.count", { count: list.total })}
          actions={
            p.canManage ? (
              <Button asChild size="sm">
                <Link href={`${path}/new`}>
                  <Plus aria-hidden />
                  {t("finance.invoices.new")}
                </Link>
              </Button>
            ) : null
          }
        />
        <form action={path} className="grid gap-2 border-b p-3 sm:grid-cols-3 lg:grid-cols-[minmax(0,1fr)_10rem_12rem_9rem_9rem_auto]">
          <Input name="q" type="search" defaultValue={f.q ?? ""} maxLength={200} placeholder={t("finance.invoices.search")} aria-label={t("finance.search")} />
          <Select name="status" defaultValue={f.status ?? ""} aria-label={t("common.status")}>
            <option value="">{t("finance.allStatuses")}</option>
            {INVOICE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`finance.invoices.statuses.${s}`)}
              </option>
            ))}
          </Select>
          <Select name="customer" defaultValue={f.accountId ?? ""} aria-label={t("finance.fields.customer")}>
            <option value="">{t("finance.allCustomers")}</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
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
        {!list.rows.length ? (
          <Empty>{filtered ? t("common.noResults") : t("finance.invoices.empty")}</Empty>
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>
                  <SortLink path={path} params={params} field="number" current={f.sort} dir={f.dir}>
                    {t("finance.billing.number")}
                  </SortLink>
                </Th>
                <Th>{t("finance.fields.customer")}</Th>
                <Th>{t("common.status")}</Th>
                <Th>
                  <SortLink path={path} params={params} field="issueDate" current={f.sort} dir={f.dir}>
                    {t("finance.billing.issueDate")}
                  </SortLink>
                </Th>
                <Th>
                  <SortLink path={path} params={params} field="dueDate" current={f.sort} dir={f.dir}>
                    {t("finance.billing.dueDate")}
                  </SortLink>
                </Th>
                <Th className="text-end">
                  <SortLink path={path} params={params} field="total" current={f.sort} dir={f.dir}>
                    {t("finance.billing.total")}
                  </SortLink>
                </Th>
                <Th className="text-end">{t("finance.invoices.balanceDue")}</Th>
              </Tr>
            </THead>
            <TBody>
              {list.rows.map((i) => (
                <Tr key={i.id}>
                  <Td>
                    <Link href={`${path}/${i.id}`} className="font-mono font-medium hover:underline">
                      {i.number}
                    </Link>
                  </Td>
                  <Td>{i.account.name}</Td>
                  <Td>
                    <StatusBadge tone={INVOICE_TONE[i.status]}>{t(`finance.invoices.statuses.${i.status}`)}</StatusBadge>
                  </Td>
                  <Td className="whitespace-nowrap">{day(i.issueDate)}</Td>
                  <Td className="whitespace-nowrap">{day(i.dueDate)}</Td>
                  <Td className="text-end tabular-nums">{money(i.totalMinor, i.currency)}</Td>
                  <Td className="text-end font-medium tabular-nums">{i.status === "VOID" || i.status === "DRAFT" ? "—" : money(i.balanceMinor, i.currency)}</Td>
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
