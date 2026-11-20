import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { DecisionForm } from "@/components/finance/approval-forms";
import { PaymentForm } from "@/components/finance/billing-actions";
import { financePage } from "@/components/finance/page-context";
import { AttachmentControl } from "@/components/finance/transaction-form";
import { ActionButton, FormDialog } from "@/components/finance/ui";
import { APPROVAL_TONE, BILL_TONE, StatusBadge } from "@/components/finance/widgets";
import { getT } from "@/i18n/server";
import { formatDateTime } from "@/i18n/format";
import { db } from "@/server/core/db";
import { AppError } from "@/server/core/errors";
import { fromMinor, todayUtc } from "@/server/modules/finance/common";
import { getBill, OPEN_BILL_STATUSES } from "@/server/modules/finance/payables";
import { listFinanceAccounts } from "@/server/modules/finance/setup";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("finance.tabs.bills") };
}

export default async function BillPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const p = await financePage("bills");
  if (p.blocked) return p.blocked;
  const { t, locale, viewer, org, company, money, base, day } = p;
  const bill = await getBill(viewer.ctx, org.id, company.id, id).catch((err) => {
    if (err instanceof AppError && err.code === "not_found") notFound();
    throw err;
  });
  const open = OPEN_BILL_STATUSES.includes(bill.status);
  const accounts = p.canManage && open ? await listFinanceAccounts(viewer.ctx, org.id, company.id) : [];
  const userIds = [...new Set(bill.approvals.flatMap((a) => [a.requestedById, ...(a.decidedById ? [a.decidedById] : []), ...a.approverIds]))];
  const users = userIds.length ? await db().user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }) : [];
  const name = (uid: string | null) => (uid ? (users.find((u) => u.id === uid)?.name ?? "—") : "—");
  const me = viewer.ctx.actor.id;
  const pending = bill.approvals.find((a) => a.status === "PENDING");
  const late = open && bill.dueDate < todayUtc();

  return p.frame(
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Link href={`/${locale}/finance/bills`} className="w-full text-xs text-muted-foreground hover:underline">
          ← {t("finance.tabs.bills")}
        </Link>
        <h2 className="font-mono text-base font-semibold">{bill.number}</h2>
        <StatusBadge tone={BILL_TONE[bill.status]}>{t(`finance.bills.statuses.${bill.status}`)}</StatusBadge>
        {late ? <StatusBadge tone="danger">{t("finance.bills.overdue")}</StatusBadge> : null}
        <Link href={`/${locale}/finance/bills?vendor=${bill.vendorId}`} className="text-sm text-muted-foreground hover:underline">
          {bill.vendor.name}
        </Link>
        <span className="ms-auto font-semibold tabular-nums">{money(bill.totalMinor, bill.currency)}</span>
      </div>
      {sp.submit === "failed" && bill.status === "DRAFT" ? <Notice tone="warning">{t("finance.bills.submitFailed")}</Notice> : null}

      {p.canManage && bill.status !== "VOID" && bill.status !== "PAID" ? (
        <Card>
          <CardBody className="flex flex-wrap items-start gap-2">
            {bill.status === "DRAFT" ? (
              <>
                <Button asChild size="sm" variant="secondary">
                  <Link href={`/${locale}/finance/bills/${bill.id}/edit`}>{t("finance.edit")}</Link>
                </Button>
                <ActionButton endpoint={`${base}/bills/${bill.id}/submit`} variant="default" label={t("finance.bills.submit")} confirm={t("finance.bills.confirmSubmit")} />
              </>
            ) : null}
            {open ? (
              <FormDialog trigger={t("finance.bills.recordPayment")} title={t("finance.bills.recordPayment")} variant="default">
                <PaymentForm
                  endpoint={`${base}/bills/${bill.id}/payments`}
                  accounts={accounts.map((a) => ({ value: a.id, label: a.name }))}
                  balance={fromMinor(bill.balanceMinor, bill.currency)}
                  currencyHint={t("finance.invoices.balanceIs", { amount: money(bill.balanceMinor, bill.currency) })}
                  accountLabel={t("finance.bills.payFrom")}
                />
              </FormDialog>
            ) : null}
            <span className="ms-auto flex flex-wrap gap-2">
              {bill.status === "DRAFT" ? <ActionButton endpoint={`${base}/bills/${bill.id}`} method="DELETE" variant="danger" label={t("finance.delete")} confirm={t("finance.bills.confirmDelete")} redirectTo={`/${locale}/finance/bills`} /> : null}
              {bill.paidMinor === 0n ? <ActionButton endpoint={`${base}/bills/${bill.id}/void`} variant="danger" label={t("finance.bills.void")} confirm={t("finance.bills.confirmVoid")} /> : null}
            </span>
          </CardBody>
        </Card>
      ) : null}

      {pending ? (
        <Card>
          <CardHeader title={t("finance.approvals.pendingTitle")} description={t("finance.approvals.waitingFor", { names: pending.approverIds.map(name).join(", ") })} />
          <CardBody>{me && pending.approverIds.includes(me) ? <DecisionForm endpoint={`${base}/approvals/${pending.id}/decision`} /> : <p className="text-sm text-muted-foreground">{t("finance.approvals.notYourDecision")}</p>}</CardBody>
        </Card>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader title={t("finance.bills.lines")} description={t("finance.bills.dates", { issue: day(bill.issueDate), due: day(bill.dueDate) })} />
          <Table>
            <THead>
              <Tr>
                <Th>{t("finance.fields.description")}</Th>
                <Th>{t("finance.bills.coding")}</Th>
                <Th className="text-end">{t("finance.billing.qty")}</Th>
                <Th className="text-end">{t("finance.billing.unitPrice")}</Th>
                <Th className="text-end">{t("finance.billing.tax")}</Th>
                <Th className="text-end">{t("finance.billing.total")}</Th>
              </Tr>
            </THead>
            <TBody>
              {bill.lines.map((l) => (
                <Tr key={l.id}>
                  <Td>{l.description}</Td>
                  <Td className="text-xs text-muted-foreground">
                    {[l.category?.name ?? t("finance.fields.uncategorized"), l.department?.name, l.project?.name].filter(Boolean).join(" · ")}
                  </Td>
                  <Td className="text-end tabular-nums">{l.quantityMilli / 1000}</Td>
                  <Td className="text-end tabular-nums">{money(l.unitPriceMinor, bill.currency)}</Td>
                  <Td className="text-end tabular-nums">{l.taxRate ? `${money(l.taxMinor, bill.currency)} (${l.taxBps / 100}%)` : "—"}</Td>
                  <Td className="text-end tabular-nums">{money(l.totalMinor, bill.currency)}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
          <dl className="ms-auto grid w-full max-w-xs gap-1 p-4 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">{t("finance.billing.subtotal")}</dt>
              <dd className="tabular-nums">{money(bill.subtotalMinor, bill.currency)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">{t("finance.billing.tax")}</dt>
              <dd className="tabular-nums">{money(bill.taxMinor, bill.currency)}</dd>
            </div>
            <div className="flex justify-between border-t pt-1 font-semibold">
              <dt>{t("finance.billing.total")}</dt>
              <dd className="tabular-nums">{money(bill.totalMinor, bill.currency)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">{t("finance.bills.paid")}</dt>
              <dd className="tabular-nums">{money(bill.paidMinor, bill.currency)}</dd>
            </div>
            <div className="flex justify-between font-medium">
              <dt>{t("finance.invoices.balanceDue")}</dt>
              <dd className="tabular-nums">{money(bill.balanceMinor, bill.currency)}</dd>
            </div>
          </dl>
          {bill.notes ? <p className="border-t p-4 text-sm whitespace-pre-line text-muted-foreground">{bill.notes}</p> : null}
        </Card>
        <div className="grid content-start gap-4">
          <Card>
            <CardHeader title={t("finance.bills.attachment")} />
            <CardBody>
              <AttachmentControl base={base} id={bill.id} href={`${base}/bills/${bill.id}/attachment`} attachment={bill.attachment} canManage={p.canManage && bill.status !== "VOID"} />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title={t("finance.payments.title")} />
            {bill.payments.length ? (
              <Table>
                <THead>
                  <Tr>
                    <Th>{t("finance.fields.date")}</Th>
                    <Th>{t("finance.payments.method")}</Th>
                    <Th className="text-end">{t("finance.fields.amount")}</Th>
                    <Th>
                      <span className="sr-only">{t("common.actions")}</span>
                    </Th>
                  </Tr>
                </THead>
                <TBody>
                  {bill.payments.map((pay) => (
                    <Tr key={pay.id}>
                      <Td className="whitespace-nowrap">{pay.transactionId ? <Link href={`/${locale}/finance/transactions/${pay.transactionId}`} className="hover:underline">{day(pay.date)}</Link> : day(pay.date)}</Td>
                      <Td>
                        {t(`finance.payments.methods.${pay.method}`)}
                        <span className="block text-xs text-muted-foreground">
                          {pay.financeAccount.name}
                          {pay.reference ? ` · ${pay.reference}` : ""}
                        </span>
                      </Td>
                      <Td className="text-end tabular-nums">{money(pay.amountMinor, bill.currency)}</Td>
                      <Td>{p.canManage ? <ActionButton endpoint={`${base}/bill-payments/${pay.id}`} method="DELETE" variant="ghost" label={t("finance.delete")} confirm={t("finance.payments.confirmDelete")} /> : null}</Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            ) : (
              <p className="p-4 text-sm text-muted-foreground">{t("finance.payments.empty")}</p>
            )}
          </Card>
          <Card>
            <CardHeader title={t("finance.approvals.history")} />
            {bill.approvals.length ? (
              <ul className="grid divide-y text-sm">
                {bill.approvals.map((a) => (
                  <li key={a.id} className="grid gap-1 px-4 py-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge tone={APPROVAL_TONE[a.status]}>{t(`finance.approvals.statuses.${a.status}`)}</StatusBadge>
                      <span className="text-muted-foreground">{t("finance.approvals.requestedBy", { name: name(a.requestedById) })}</span>
                      <span className="ms-auto text-xs text-muted-foreground">{formatDateTime(a.createdAt, locale, p.tz)}</span>
                    </div>
                    {a.decidedAt && a.decidedById ? <p className="text-xs text-muted-foreground">{t("finance.approvals.decidedBy", { name: name(a.decidedById), date: formatDateTime(a.decidedAt, locale, p.tz) })}</p> : null}
                    {a.decisionNote ? <p className="text-xs whitespace-pre-line">{a.decisionNote}</p> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="p-4 text-sm text-muted-foreground">{t("finance.approvals.noHistory")}</p>
            )}
          </Card>
          <Card>
            <CardBody className="grid gap-1 text-xs text-muted-foreground">
              {bill.submittedAt ? <p>{t("finance.bills.submittedAt", { date: formatDateTime(bill.submittedAt, locale, p.tz) })}</p> : null}
              {bill.approvedAt ? <p>{t("finance.bills.approvedAt", { date: formatDateTime(bill.approvedAt, locale, p.tz) })}</p> : null}
              {bill.paidAt ? <p>{t("finance.invoices.paidAt", { date: formatDateTime(bill.paidAt, locale, p.tz) })}</p> : null}
              {bill.voidedAt ? <p>{t("finance.bills.voidedAt", { date: formatDateTime(bill.voidedAt, locale, p.tz) })}</p> : null}
              <Link href={`/${locale}/finance/accounting/journal?q=${encodeURIComponent(bill.number)}`} className="hover:underline">
                {t("finance.transactions.viewJournal")}
              </Link>
            </CardBody>
          </Card>
        </div>
      </div>
    </>,
  );
}
