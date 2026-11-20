import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PrintButton } from "@/components/finance/billing-actions";
import { InvoiceDocument, PrintStyles } from "@/components/finance/invoice-document";
import { getLocale, getT } from "@/i18n/server";
import { getPublicInvoice } from "@/server/modules/finance/billing";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("finance.document.invoice"), robots: { index: false, follow: false }, referrer: "no-referrer" };
}

/** Public, login-free view of an issued invoice via its unguessable token (shared with the customer). */
export default async function PublicInvoicePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const locale = await getLocale();
  const t = await getT(locale);
  const inv = await getPublicInvoice(token);
  if (!inv) notFound();
  return (
    <main className="min-h-screen bg-muted/40 px-4 py-8">
      <PrintStyles />
      <div className="mx-auto grid max-w-3xl gap-3">
        <div className="flex items-center justify-between gap-2 print:hidden">
          <p className="text-xs text-muted-foreground">{t("finance.document.publicNote", { company: inv.company.legalName || inv.company.name })}</p>
          <PrintButton />
        </div>
        <InvoiceDocument t={t} locale={locale} doc={{ kind: "invoice", ...inv, company: inv.company, customer: inv.account, footer: inv.footer }} />
      </div>
    </main>
  );
}
