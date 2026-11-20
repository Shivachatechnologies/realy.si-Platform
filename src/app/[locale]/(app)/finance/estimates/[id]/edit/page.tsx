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
import { getEstimate } from "@/server/modules/finance/billing";
import { dayString } from "@/server/modules/finance/common";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("finance.tabs.estimates") };
}

export default async function EditEstimatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p = await financePage("estimates");
  if (p.blocked) return p.blocked;
  const { t, locale, viewer, org, company, base } = p;
  const e = await getEstimate(viewer.ctx, org.id, company.id, id).catch((err) => {
    if (err instanceof AppError && err.code === "not_found") notFound();
    throw err;
  });
  const back = (
    <Link href={`/${locale}/finance/estimates/${e.id}`} className="text-xs text-muted-foreground hover:underline">
      ← {e.number}
    </Link>
  );
  if (!p.canManage || e.status === "CONVERTED") return p.frame(<>{back}<Notice tone="warning">{t("finance.estimates.notEditable")}</Notice></>);
  const opts = await documentOptions(viewer.ctx, org.id, company.id, t("finance.tax.inclusive"));
  return p.frame(
    <>
      {back}
      <Card>
        <CardHeader title={t("finance.estimates.editTitle", { number: e.number })} />
        <CardBody>
          <DocumentForm
            kind="estimate"
            id={e.id}
            base={base}
            locale={locale}
            currency={e.currency}
            customers={opts.customers}
            taxRates={opts.taxRates}
            initial={{ accountId: e.accountId, issueDate: dayString(e.issueDate), expiryDate: e.expiryDate ? dayString(e.expiryDate) : "", discount: e.discountBps ? String(e.discountBps / 100) : "", notes: e.notes ?? "", terms: e.terms ?? "", lines: linesToValues(e.lines, e.currency) }}
          />
        </CardBody>
      </Card>
    </>,
  );
}
