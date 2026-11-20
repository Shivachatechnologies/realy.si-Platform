import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { documentOptions, linesToValues } from "@/components/finance/billing-data";
import { DocumentForm } from "@/components/finance/document-form";
import { financePage } from "@/components/finance/page-context";
import { getT } from "@/i18n/server";
import { AppError } from "@/server/core/errors";
import { getInvoice } from "@/server/modules/finance/billing";
import { dayString } from "@/server/modules/finance/common";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("finance.tabs.invoices") };
}

export default async function EditInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p = await financePage("invoices");
  if (p.blocked) return p.blocked;
  const { t, locale, viewer, org, company, base } = p;
  const inv = await getInvoice(viewer.ctx, org.id, company.id, id).catch((err) => {
    if (err instanceof AppError && err.code === "not_found") notFound();
    throw err;
  });
  const back = (
    <Link href={`/${locale}/finance/invoices/${inv.id}`} className="text-xs text-muted-foreground hover:underline">
      ← {inv.number}
    </Link>
  );
  if (!p.canManage || inv.status !== "DRAFT") return p.frame(<>{back}<Notice tone="warning">{t("finance.invoices.onlyDraftEditable")}</Notice></>);
  const opts = await documentOptions(viewer.ctx, org.id, company.id, t("finance.tax.inclusive"));
  return p.frame(
    <>
      {back}
      <Card>
        <CardHeader title={t("finance.invoices.editTitle", { number: inv.number })} />
        <CardBody>
          <DocumentForm
            kind="invoice"
            id={inv.id}
            base={base}
            locale={locale}
            currency={inv.currency}
            customers={opts.customers}
            taxRates={opts.taxRates}
            initial={{ accountId: inv.accountId, issueDate: dayString(inv.issueDate), dueDate: dayString(inv.dueDate), discount: inv.discountBps ? String(inv.discountBps / 100) : "", notes: inv.notes ?? "", terms: inv.terms ?? "", lines: linesToValues(inv.lines, inv.currency) }}
          />
        </CardBody>
      </Card>
    </>,
  );
}
