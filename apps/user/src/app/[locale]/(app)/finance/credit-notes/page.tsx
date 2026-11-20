import type { Metadata } from "next";
import Link from "next/link";
import { Card, CardHeader } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { financePage } from "@/components/finance/page-context";
import { ActionButton, ResourceForm } from "@/components/finance/ui";
import { Empty, Pager, StatusBadge } from "@/components/finance/widgets";
import { getT } from "@/i18n/server";
import { db } from "@/server/core/db";
import { balanceOf, listCreditNotes, OPEN_STATUSES } from "@/server/modules/finance/billing";
import { dayString, isUuid, pageParam, param } from "@/server/modules/finance/common";
import { listCounterparties } from "@/server/modules/finance/setup";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("finance.tabs.creditNotes") };
}

const TONE = { OPEN: "accent", APPLIED: "success", VOID: "neutral" } as const;

export default async function CreditNotesPage({ searchParams }: PageProps<"/[locale]/finance/credit-notes">) {
  const p = await financePage("creditNotes");
  if (p.blocked) return p.blocked;
  const { t, locale, viewer, org, company, money, base, day } = p;
  const params = await searchParams;
  const q = param(params, "q")?.slice(0, 200);
  const status = param(params, "status");
  const page = pageParam(params);
  const presetCustomer = param(params, "customer");
  const presetInvoice = param(params, "invoice");
  const [list, customers, openInvoices] = await Promise.all([
    listCreditNotes(viewer.ctx, org.id, company.id, { q, status, page }),
    p.canManage ? listCounterparties(viewer.ctx, org.id, company.id, "CUSTOMER") : Promise.resolve([]),
    p.canManage ? db().invoice.findMany({ where: { companyId: company.id, status: { in: OPEN_STATUSES } }, orderBy: { dueDate: "asc" }, take: 500, include: { account: { select: { name: true } } } }) : Promise.resolve([]),
  ]);
  const path = `/${locale}/finance/credit-notes`;
  return p.frame(
    <>
      {p.canManage ? (
        <Card>
          <details open={!!presetCustomer}>
            <summary className="cursor-pointer px-4 py-3 text-sm font-medium">{t("finance.creditNotes.new")}</summary>
            <div className="border-t p-4">
              <ResourceForm
                endpoint={`${base}/credit-notes`}
                submitLabel={t("finance.creditNotes.new")}
                initial={{ accountId: isUuid(presetCustomer) ? presetCustomer : "", invoiceId: isUuid(presetInvoice) ? presetInvoice : "", issueDate: dayString(new Date()) }}
                fields={[
                  { name: "accountId", label: t("finance.fields.customer"), type: "select", required: true, emptyLabel: "—", options: customers.map((c) => ({ value: c.id, label: c.name })) },
                  { name: "issueDate", label: t("finance.billing.issueDate"), type: "date", required: true },
                  { name: "amount", label: t("finance.fields.amount"), type: "amount", required: true },
                  { name: "invoiceId", label: t("finance.creditNotes.applyTo"), type: "select", emptyLabel: t("finance.creditNotes.applyLater"), options: openInvoices.map((i) => ({ value: i.id, label: `${i.number} · ${i.account.name} · ${money(balanceOf(i), i.currency)}` })), span: 2 },
                  { name: "reason", label: t("finance.creditNotes.reason"), type: "textarea", required: true, span: 3, maxLength: 1000 },
                ]}
              />
            </div>
          </details>
        </Card>
      ) : null}
      <Card>
        <CardHeader title={t("finance.tabs.creditNotes")} description={t("finance.creditNotes.hint")} />
        <form action={path} className="grid gap-2 border-b p-3 sm:grid-cols-[minmax(0,1fr)_10rem_auto]">
          <Input name="q" type="search" defaultValue={q ?? ""} maxLength={200} placeholder={t("finance.search")} aria-label={t("finance.search")} />
          <Select name="status" defaultValue={status ?? ""} aria-label={t("common.status")}>
            <option value="">{t("finance.allStatuses")}</option>
            {(["OPEN", "APPLIED", "VOID"] as const).map((s) => (
              <option key={s} value={s}>
                {t(`finance.creditNotes.statuses.${s}`)}
              </option>
            ))}
          </Select>
          <Button type="submit" variant="secondary">
            {t("finance.apply")}
          </Button>
        </form>
        {!list.rows.length ? (
          <Empty>{q || status ? t("common.noResults") : t("finance.creditNotes.empty")}</Empty>
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>{t("finance.billing.number")}</Th>
                <Th>{t("finance.fields.customer")}</Th>
                <Th>{t("finance.billing.issueDate")}</Th>
                <Th>{t("finance.creditNotes.reason")}</Th>
                <Th>{t("finance.creditNotes.appliedTo")}</Th>
                <Th className="text-end">{t("finance.fields.amount")}</Th>
                <Th className="text-end">{t("finance.creditNotes.remaining")}</Th>
                <Th>
                  <span className="sr-only">{t("common.actions")}</span>
                </Th>
              </Tr>
            </THead>
            <TBody>
              {list.rows.map((c) => (
                <Tr key={c.id}>
                  <Td>
                    <span className="font-mono font-medium">{c.number}</span> <StatusBadge tone={TONE[c.status]}>{t(`finance.creditNotes.statuses.${c.status}`)}</StatusBadge>
                  </Td>
                  <Td>{c.account.name}</Td>
                  <Td className="whitespace-nowrap">{day(c.issueDate)}</Td>
                  <Td className="max-w-64 truncate text-muted-foreground" title={c.reason}>
                    {c.reason}
                  </Td>
                  <Td className="text-xs">
                    {c.applications.map((a) => (
                      <Link key={a.id} href={`/${locale}/finance/invoices/${a.invoice.id}`} className="me-2 hover:underline">
                        {a.invoice.number} ({money(a.amountMinor, c.currency)})
                      </Link>
                    ))}
                  </Td>
                  <Td className="text-end tabular-nums">{money(c.amountMinor, c.currency)}</Td>
                  <Td className="text-end tabular-nums">{money(c.amountMinor - c.appliedMinor, c.currency)}</Td>
                  <Td>{p.canManage && c.status === "OPEN" && c.appliedMinor === 0n ? <ActionButton endpoint={`${base}/credit-notes/${c.id}/void`} label={t("finance.invoices.void")} variant="ghost" confirm={t("finance.creditNotes.confirmVoid")} /> : null}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
        <Pager path={path} params={params} page={page} pages={list.pages} labels={{ previous: t("common.previous"), next: t("common.next"), page: t("finance.pageOf", { page, pages: list.pages }) }} />
      </Card>
    </>,
  );
}
