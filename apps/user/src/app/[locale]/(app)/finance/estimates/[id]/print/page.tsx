import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PrintButton } from "@/components/finance/billing-actions";
import { InvoiceDocument, PrintStyles } from "@/components/finance/invoice-document";
import { financePage } from "@/components/finance/page-context";
import { getT } from "@/i18n/server";
import { db } from "@/server/core/db";
import { AppError } from "@/server/core/errors";
import { getEstimate } from "@/server/modules/finance/billing";
import { financeSettings } from "@/server/modules/finance/common";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("finance.document.estimate") };
}

export default async function PrintEstimatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p = await financePage("estimates");
  if (p.blocked) return p.blocked;
  const { t, locale, viewer, org, company } = p;
  const e = await getEstimate(viewer.ctx, org.id, company.id, id).catch((err) => {
    if (err instanceof AppError && err.code === "not_found") notFound();
    throw err;
  });
  const settings = await financeSettings(db(), org.id, company.id);
  return (
    <div className="mx-auto grid max-w-3xl gap-3">
      <PrintStyles />
      <div className="flex items-center justify-between gap-2 print:hidden">
        <Link href={`/${locale}/finance/estimates/${e.id}`} className="text-xs text-muted-foreground hover:underline">
          ← {e.number}
        </Link>
        <PrintButton />
      </div>
      <InvoiceDocument t={t} locale={locale} doc={{ kind: "estimate", ...e, company: { name: company.name, legalName: company.legalName }, customer: e.account, footer: settings.invoiceFooter }} />
    </div>
  );
}
