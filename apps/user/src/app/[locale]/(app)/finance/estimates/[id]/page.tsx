import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { SendEmailForm } from "@/components/finance/billing-actions";
import { InvoiceDocument } from "@/components/finance/invoice-document";
import { financePage } from "@/components/finance/page-context";
import { ActionButton, FormDialog } from "@/components/finance/ui";
import { ESTIMATE_TONE, StatusBadge } from "@/components/finance/widgets";
import { getT } from "@/i18n/server";
import { formatDateTime } from "@/i18n/format";
import { db } from "@/server/core/db";
import { AppError } from "@/server/core/errors";
import { emailConfigured } from "@/server/modules/email/service";
import { getEstimate } from "@/server/modules/finance/billing";
import { financeSettings } from "@/server/modules/finance/common";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("finance.tabs.estimates") };
}

const EMAIL_TONE = { SENT: "success", FAILED: "danger", NOT_CONFIGURED: "warning" } as const;

export default async function EstimatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p = await financePage("estimates");
  if (p.blocked) return p.blocked;
  const { t, locale, viewer, org, company, money, base, day } = p;
  const e = await getEstimate(viewer.ctx, org.id, company.id, id).catch((err) => {
    if (err instanceof AppError && err.code === "not_found") notFound();
    throw err;
  });
  const settings = await financeSettings(db(), org.id, company.id);
  const vars = { number: e.number, company: company.legalName || company.name, customer: e.account.name, total: money(e.totalMinor, e.currency), expiry: e.expiryDate ? day(e.expiryDate) : "—" };
  const editable = e.status !== "CONVERTED";
  return p.frame(
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Link href={`/${locale}/finance/estimates`} className="w-full text-xs text-muted-foreground hover:underline">
          ← {t("finance.tabs.estimates")}
        </Link>
        <h2 className="font-mono text-base font-semibold">{e.number}</h2>
        <StatusBadge tone={ESTIMATE_TONE[e.status]}>{t(`finance.estimates.statuses.${e.status}`)}</StatusBadge>
        <span className="text-sm text-muted-foreground">{e.account.name}</span>
        <span className="ms-auto font-semibold tabular-nums">{money(e.totalMinor, e.currency)}</span>
      </div>
      {p.canManage ? (
        <Card>
          <CardBody className="flex flex-wrap items-start gap-2">
            {editable ? (
              <>
                <Button asChild size="sm" variant="secondary">
                  <Link href={`/${locale}/finance/estimates/${e.id}/edit`}>{t("finance.edit")}</Link>
                </Button>
                <FormDialog trigger={t("finance.estimates.send")} title={t("finance.estimates.send")} description={emailConfigured() ? undefined : t("finance.email.notConfigured")}>
                  <SendEmailForm endpoint={`${base}/estimates/${e.id}/send`} to={e.account.email} subject={t("finance.email.estimateSubject", vars)} message={t("finance.email.estimateBody", vars)} />
                </FormDialog>
                {e.status === "DRAFT" ? <ActionButton endpoint={`${base}/estimates/${e.id}/status`} body={{ status: "SENT" }} label={t("finance.estimates.markSent")} /> : null}
                {e.status !== "ACCEPTED" ? <ActionButton endpoint={`${base}/estimates/${e.id}/status`} body={{ status: "ACCEPTED" }} label={t("finance.estimates.markAccepted")} /> : null}
                {e.status !== "DECLINED" ? <ActionButton endpoint={`${base}/estimates/${e.id}/status`} body={{ status: "DECLINED" }} label={t("finance.estimates.markDeclined")} variant="ghost" /> : null}
                {e.status !== "DECLINED" ? <ActionButton endpoint={`${base}/estimates/${e.id}/convert`} label={t("finance.estimates.convert")} variant="default" redirectTo={`/${locale}/finance/invoices/:id`} /> : null}
              </>
            ) : e.invoiceId ? (
              <Button asChild size="sm" variant="secondary">
                <Link href={`/${locale}/finance/invoices/${e.invoiceId}`}>{t("finance.estimates.viewInvoice")}</Link>
              </Button>
            ) : null}
            <Button asChild size="sm" variant="secondary">
              <Link href={`/${locale}/finance/estimates/${e.id}/print`}>
                <Printer aria-hidden />
                {t("finance.print")}
              </Link>
            </Button>
            {editable ? (
              <span className="ms-auto">
                <ActionButton endpoint={`${base}/estimates/${e.id}`} method="DELETE" variant="danger" label={t("finance.delete")} confirm={t("finance.estimates.confirmDelete")} redirectTo={`/${locale}/finance/estimates`} />
              </span>
            ) : null}
          </CardBody>
        </Card>
      ) : null}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <InvoiceDocument t={t} locale={locale} doc={{ kind: "estimate", ...e, company: { name: company.name, legalName: company.legalName }, customer: e.account, footer: settings.invoiceFooter }} />
        <Card className="content-start">
          <CardHeader title={t("finance.email.history")} />
          {e.emails.length ? (
            <ul className="grid divide-y text-sm">
              {e.emails.map((m) => (
                <li key={m.id} className="flex flex-wrap items-center gap-2 px-4 py-2">
                  <StatusBadge tone={EMAIL_TONE[m.status]}>{t(`finance.email.statuses.${m.status}`)}</StatusBadge>
                  <span className="text-muted-foreground">{m.toEmail}</span>
                  <span className="ms-auto text-xs text-muted-foreground">{formatDateTime(m.createdAt, locale, p.tz)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="p-4 text-sm text-muted-foreground">{t("finance.email.none")}</p>
          )}
        </Card>
      </div>
    </>,
  );
}
