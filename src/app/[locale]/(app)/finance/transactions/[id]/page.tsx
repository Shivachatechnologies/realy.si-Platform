import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { financePage } from "@/components/finance/page-context";
import { txnOptions } from "@/components/finance/options";
import { AttachmentControl, TransactionForm } from "@/components/finance/transaction-form";
import { ActionButton } from "@/components/finance/ui";
import { StatusBadge } from "@/components/finance/widgets";
import { getT } from "@/i18n/server";
import { AppError } from "@/server/core/errors";
import { dayString, fromMinor } from "@/server/modules/finance/common";
import { getTransaction } from "@/server/modules/finance/transactions";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("finance.tabs.transactions") };
}

export default async function TransactionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p = await financePage("transactions");
  if (p.blocked) return p.blocked;
  const { t, locale, viewer, org, company, money, base, day } = p;
  const txn = await getTransaction(viewer.ctx, org.id, company.id, id).catch((err) => {
    if (err instanceof AppError && err.code === "not_found") notFound();
    throw err;
  });
  const options = p.canManage ? await txnOptions(viewer.ctx, org.id, company.id) : null;
  const fromPayment = !!txn.paymentId;

  return p.frame(
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Link href={`/${locale}/finance/transactions`} className="text-xs text-muted-foreground hover:underline">
          ← {t("finance.tabs.transactions")}
        </Link>
        <h2 className="w-full text-base font-semibold">{txn.description}</h2>
        <StatusBadge tone={txn.type === "INCOME" ? "success" : txn.type === "EXPENSE" ? "danger" : "neutral"}>{t(`finance.transactions.types.${txn.type}`)}</StatusBadge>
        <span className="font-semibold tabular-nums">{money(txn.amountMinor, txn.currency)}</span>
        <span className="text-sm text-muted-foreground">{day(txn.date)}</span>
        <StatusBadge tone="neutral">{t(`finance.transactions.sources.${txn.source}`)}</StatusBadge>
        {txn.reconciledAt ? <StatusBadge tone="success">{t("finance.transactions.reconciled")}</StatusBadge> : null}
        {txn.journalEntryId ? (
          <Link href={`/${locale}/finance/accounting/journal/${txn.journalEntryId}`} className="text-xs hover:underline">
            {t("finance.transactions.viewJournal")}
          </Link>
        ) : null}
        {txn.invoiceId ? (
          <Link href={`/${locale}/finance/invoices/${txn.invoiceId}`} className="text-xs hover:underline">
            {t("finance.transactions.viewInvoice")}
          </Link>
        ) : null}
        {txn.recurring ? <span className="text-xs text-muted-foreground">{t("finance.transactions.fromRecurring", { name: txn.recurring.name })}</span> : null}
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader title={p.canManage && !fromPayment ? t("finance.edit") : t("finance.details")} />
          <CardBody>
            {fromPayment ? <Notice className="mb-3">{t("finance.transactions.paymentManaged")}</Notice> : null}
            {p.canManage && options && !fromPayment ? (
              <TransactionForm
                base={base}
                locale={locale}
                options={options}
                id={txn.id}
                readOnlyMoney={!!txn.reconciledAt}
                initial={{
                  type: txn.type,
                  date: dayString(txn.date),
                  amount: fromMinor(txn.amountMinor, txn.currency),
                  financeAccountId: txn.financeAccountId,
                  toAccountId: txn.toAccountId ?? "",
                  categoryId: txn.categoryId ?? "",
                  accountId: txn.accountId ?? "",
                  departmentId: txn.departmentId ?? "",
                  description: txn.description,
                  reference: txn.reference ?? "",
                  notes: txn.notes ?? "",
                }}
              />
            ) : (
              <dl className="grid gap-2 text-sm sm:grid-cols-2">
                {(
                  [
                    [t("finance.fields.account"), txn.type === "TRANSFER" ? `${txn.financeAccount.name} → ${txn.toAccount?.name ?? ""}` : txn.financeAccount.name],
                    [t("finance.fields.category"), txn.category?.name],
                    [t("finance.fields.counterparty"), txn.account?.name],
                    [t("finance.fields.costCenter"), txn.department?.name],
                    [t("finance.fields.reference"), txn.reference],
                    [t("finance.fields.notes"), txn.notes],
                  ] as [string, string | null | undefined][]
                ).map(([k, v]) => (
                  <div key={k}>
                    <dt className="text-xs text-muted-foreground">{k}</dt>
                    <dd className="whitespace-pre-line">{v || "—"}</dd>
                  </div>
                ))}
              </dl>
            )}
          </CardBody>
        </Card>
        <div className="grid content-start gap-4">
          <Card>
            <CardHeader title={t("finance.transactions.attachment")} description={t("finance.transactions.attachmentHint")} />
            <CardBody>
              <AttachmentControl base={base} id={txn.id} attachment={txn.attachment} canManage={p.canManage} />
            </CardBody>
          </Card>
          {p.canManage && !fromPayment && !txn.reconciledAt ? (
            <Card>
              <CardBody>
                <ActionButton endpoint={`${base}/transactions/${txn.id}`} method="DELETE" variant="danger" label={t("finance.delete")} confirm={t("finance.transactions.confirmDelete")} redirectTo={`/${locale}/finance/transactions`} />
              </CardBody>
            </Card>
          ) : null}
        </div>
      </div>
    </>,
  );
}
