import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { ApplyCreditForm, CopyLink, PaymentForm, SendEmailForm } from "@/components/finance/billing-actions";
import { PaymentLinkPanel } from "@/components/finance/payment-link";
import { InvoiceDocument } from "@/components/finance/invoice-document";
import { financePage } from "@/components/finance/page-context";
import { ActionButton, FormDialog } from "@/components/finance/ui";
import { INVOICE_TONE, StatusBadge } from "@/components/finance/widgets";
import { getT } from "@/i18n/server";
import { formatDateTime } from "@/i18n/format";
import { db } from "@/server/core/db";
import { AppError } from "@/server/core/errors";
import { emailConfigured } from "@/server/modules/email/service";
import { getInvoice, OPEN_STATUSES, publicInvoiceUrl } from "@/server/modules/finance/billing";
import { financeSettings, fromMinor } from "@/server/modules/finance/common";
import { listFinanceAccounts } from "@/server/modules/finance/setup";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("finance.tabs.invoices") };
}

const EMAIL_TONE = { SENT: "success", FAILED: "danger", NOT_CONFIGURED: "warning" } as const;

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p = await financePage("invoices");
  if (p.blocked) return p.blocked;
  const { t, locale, viewer, org, company, money, base, day } = p;
  const inv = await getInvoice(viewer.ctx, org.id, company.id, id).catch((err) => {
    if (err instanceof AppError && err.code === "not_found") notFound();
    throw err;
  });
  const [settings, accounts, credits] = await Promise.all([
    financeSettings(db(), org.id, company.id),
    p.canManage ? listFinanceAccounts(viewer.ctx, org.id, company.id) : Promise.resolve([]),
    db().creditNote.findMany({ where: { companyId: company.id, accountId: inv.accountId, status: "OPEN" }, orderBy: { issueDate: "asc" } }),
  ]);
  const open = OPEN_STATUSES.includes(inv.status);
  const link = inv.publicToken && inv.status !== "DRAFT" ? publicInvoiceUrl(inv.publicToken, locale) : null;
  const emailVars = { number: inv.number, company: company.legalName || company.name, customer: inv.account.name, total: money(inv.totalMinor, inv.currency), balance: money(inv.balanceMinor, inv.currency), due: day(inv.dueDate) };

  return p.frame(
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Link href={`/${locale}/finance/invoices`} className="w-full text-xs text-muted-foreground hover:underline">
          ← {t("finance.tabs.invoices")}
        </Link>
        <h2 className="font-mono text-base font-semibold">{inv.number}</h2>
        <StatusBadge tone={INVOICE_TONE[inv.status]}>{t(`finance.invoices.statuses.${inv.status}`)}</StatusBadge>
        <span className="text-sm text-muted-foreground">{inv.account.name}</span>
        <span className="ms-auto font-semibold tabular-nums">{money(inv.totalMinor, inv.currency)}</span>
      </div>

      {inv.paymentLinkUrl || (p.canManage && inv.status !== "VOID" && inv.status !== "PAID") ? (
        <Card>
          <CardHeader title={t("finance.os.payLinkTitle")} />
          <CardBody>
            <PaymentLinkPanel endpoint={`${base}/invoices/${inv.id}/payment-link`} locale={locale} url={inv.paymentLinkUrl} provider={inv.paymentLinkProvider} canCreate={p.canManage && inv.status !== "VOID" && inv.status !== "PAID"} />
          </CardBody>
        </Card>
      ) : null}
      {p.canManage ? (
        <Card>
          <CardBody className="flex flex-wrap items-start gap-2">
            {inv.status === "DRAFT" ? (
              <>
                <Button asChild size="sm" variant="secondary">
                  <Link href={`/${locale}/finance/invoices/${inv.id}/edit`}>{t("finance.edit")}</Link>
                </Button>
                <ActionButton endpoint={`${base}/invoices/${inv.id}/mark-sent`} label={t("finance.invoices.markSent")} confirm={t("finance.invoices.confirmIssue")} />
              </>
            ) : null}
            {inv.status !== "VOID" ? (
              <FormDialog trigger={t("finance.invoices.sendInvoice")} title={t("finance.invoices.sendInvoice")} description={emailConfigured() ? undefined : t("finance.email.notConfigured")}>
                <SendEmailForm endpoint={`${base}/invoices/${inv.id}/send`} to={inv.account.email} subject={t("finance.email.invoiceSubject", emailVars)} message={t("finance.email.invoiceBody", emailVars)} />
              </FormDialog>
            ) : null}
            {open ? (
              <>
                <FormDialog trigger={t("finance.invoices.sendReminder")} title={t("finance.invoices.sendReminder")} description={emailConfigured() ? undefined : t("finance.email.notConfigured")}>
                  <SendEmailForm endpoint={`${base}/invoices/${inv.id}/remind`} to={inv.account.email} subject={t("finance.email.reminderSubject", emailVars)} message={t("finance.email.reminderBody", emailVars)} />
                </FormDialog>
                <FormDialog trigger={t("finance.payments.record")} title={t("finance.payments.record")} variant="default">
                  <PaymentForm endpoint={`${base}/invoices/${inv.id}/payments`} accounts={accounts.map((a) => ({ value: a.id, label: a.name }))} balance={fromMinor(inv.balanceMinor, inv.currency)} currencyHint={t("finance.invoices.balanceIs", { amount: money(inv.balanceMinor, inv.currency) })} />
                </FormDialog>
                {credits.length ? (
                  <FormDialog trigger={t("finance.creditNotes.apply")} title={t("finance.creditNotes.apply")}>
                    <ApplyCreditForm
                      base={base}
                      invoiceId={inv.id}
                      credits={credits.map((c) => {
                        const remaining = c.amountMinor - c.appliedMinor;
                        const amt = remaining < inv.balanceMinor ? remaining : inv.balanceMinor;
                        return { id: c.id, label: `${c.number} · ${money(remaining, c.currency)}`, remaining: fromMinor(amt, c.currency) };
                      })}
                    />
                  </FormDialog>
                ) : null}
              </>
            ) : null}
            <Button asChild size="sm" variant="secondary">
              <Link href={`/${locale}/finance/invoices/${inv.id}/print`}>
                <Printer aria-hidden />
                {t("finance.print")}
              </Link>
            </Button>
            {inv.status !== "DRAFT" && inv.status !== "VOID" ? (
              <Button asChild size="sm" variant="ghost">
                <Link href={`/${locale}/finance/credit-notes?customer=${inv.accountId}&invoice=${inv.id}`}>{t("finance.creditNotes.issueFor")}</Link>
              </Button>
            ) : null}
            <span className="ms-auto flex flex-wrap gap-2">
              {inv.status === "DRAFT" ? <ActionButton endpoint={`${base}/invoices/${inv.id}`} method="DELETE" variant="danger" label={t("finance.delete")} confirm={t("finance.invoices.confirmDelete")} redirectTo={`/${locale}/finance/invoices`} /> : null}
              {inv.status !== "DRAFT" && inv.status !== "VOID" && inv.paidMinor === 0n && inv.creditedMinor === 0n ? <ActionButton endpoint={`${base}/invoices/${inv.id}/void`} variant="danger" label={t("finance.invoices.void")} confirm={t("finance.invoices.confirmVoid")} /> : null}
            </span>
          </CardBody>
        </Card>
      ) : null}

      {link ? (
        <Card>
          <CardHeader title={t("finance.invoices.publicLink")} description={t("finance.invoices.publicLinkHint")} />
          <CardBody>
            <CopyLink url={link} />
          </CardBody>
        </Card>
      ) : inv.status === "DRAFT" ? (
        <Notice>{t("finance.invoices.draftNotice")}</Notice>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <InvoiceDocument t={t} locale={locale} doc={{ kind: "invoice", ...inv, company: { name: company.name, legalName: company.legalName }, customer: inv.account, footer: settings.invoiceFooter }} />
        <div className="grid content-start gap-4">
          <Card>
            <CardHeader title={t("finance.payments.title")} />
            {inv.payments.length ? (
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
                  {inv.payments.map((pay) => (
                    <Tr key={pay.id}>
                      <Td className="whitespace-nowrap">{day(pay.date)}</Td>
                      <Td>
                        {t(`finance.payments.methods.${pay.method}`)}
                        <span className="block text-xs text-muted-foreground">
                          {pay.financeAccount.name}
                          {pay.reference ? ` · ${pay.reference}` : ""}
                        </span>
                      </Td>
                      <Td className="text-end tabular-nums">{money(pay.amountMinor, inv.currency)}</Td>
                      <Td>{p.canManage ? <ActionButton endpoint={`${base}/payments/${pay.id}`} method="DELETE" variant="ghost" label={t("finance.delete")} confirm={t("finance.payments.confirmDelete")} /> : null}</Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            ) : (
              <p className="p-4 text-sm text-muted-foreground">{t("finance.payments.empty")}</p>
            )}
            {inv.credits.length ? (
              <ul className="grid gap-1 border-t p-4 text-sm">
                {inv.credits.map((c) => (
                  <li key={c.id} className="flex justify-between gap-2">
                    <span>{t("finance.creditNotes.appliedFrom", { number: c.creditNote.number })}</span>
                    <span className="tabular-nums">−{money(c.amountMinor, inv.currency)}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </Card>
          <Card>
            <CardHeader title={t("finance.email.history")} />
            {inv.emails.length ? (
              <ul className="grid divide-y text-sm">
                {inv.emails.map((e) => (
                  <li key={e.id} className="flex flex-wrap items-center gap-2 px-4 py-2">
                    <StatusBadge tone={EMAIL_TONE[e.status]}>{t(`finance.email.statuses.${e.status}`)}</StatusBadge>
                    <span>{t(`finance.email.kinds.${e.kind}`)}</span>
                    <span className="text-muted-foreground">{e.toEmail}</span>
                    <span className="ms-auto text-xs text-muted-foreground">{formatDateTime(e.createdAt, locale, p.tz)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="p-4 text-sm text-muted-foreground">{t("finance.email.none")}</p>
            )}
          </Card>
          <Card>
            <CardBody className="grid gap-1 text-xs text-muted-foreground">
              {inv.issuedAt ? <p>{t("finance.invoices.issuedAt", { date: formatDateTime(inv.issuedAt, locale, p.tz) })}</p> : null}
              {inv.sentAt ? <p>{t("finance.invoices.sentAt", { date: formatDateTime(inv.sentAt, locale, p.tz) })}</p> : null}
              {inv.lastReminderAt ? <p>{t("finance.invoices.remindedAt", { date: formatDateTime(inv.lastReminderAt, locale, p.tz) })}</p> : null}
              {inv.paidAt ? <p>{t("finance.invoices.paidAt", { date: formatDateTime(inv.paidAt, locale, p.tz) })}</p> : null}
              {inv.estimateId ? (
                <Link href={`/${locale}/finance/estimates/${inv.estimateId}`} className="hover:underline">
                  {t("finance.invoices.fromEstimate")}
                </Link>
              ) : null}
            </CardBody>
          </Card>
        </div>
      </div>
    </>,
  );
}
