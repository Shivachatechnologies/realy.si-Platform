import { formatDate, formatMoney } from "@/i18n/format";

export interface DocumentData {
  kind: "invoice" | "estimate";
  number: string;
  status: string;
  issueDate: Date;
  dueDate?: Date | null;
  expiryDate?: Date | null;
  currency: string;
  company: { name: string; legalName?: string | null };
  customer: { name: string; email?: string | null; address?: string | null; phone?: string | null };
  lines: { id: string; description: string; quantityMilli: number; unitPriceMinor: bigint; discountBps: number; taxBps: number; taxInclusive: boolean; totalMinor: bigint; taxRate?: { name: string } | null }[];
  subtotalMinor: bigint;
  discountMinor: bigint;
  taxMinor: bigint;
  totalMinor: bigint;
  paidMinor?: bigint;
  creditedMinor?: bigint;
  balanceMinor?: bigint;
  notes?: string | null;
  terms?: string | null;
  footer?: string | null;
}

/**
 * Printable invoice / estimate. `#fin-print` is the only thing visible when printing (see PrintStyles), so the app shell
 * never ends up on paper.
 */
export function InvoiceDocument({ doc, t, locale }: { doc: DocumentData; t: (k: string, v?: Record<string, string | number>) => string; locale: string }) {
  const money = (v: bigint) => formatMoney({ amountMinor: v, currency: doc.currency }, locale);
  const day = (d: Date) => formatDate(d, locale, "UTC");
  const anyInclusive = doc.lines.some((l) => l.taxInclusive && l.taxBps > 0);
  return (
    <article id="fin-print" className="mx-auto grid w-full max-w-3xl gap-6 rounded-lg border bg-white p-6 text-sm text-black sm:p-10 print:border-0 print:p-0">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-lg font-semibold">{doc.company.legalName || doc.company.name}</p>
          {doc.company.legalName && doc.company.legalName !== doc.company.name ? <p className="text-neutral-600">{doc.company.name}</p> : null}
        </div>
        <div className="text-end">
          <p className="text-2xl font-semibold tracking-tight uppercase">{t(`finance.document.${doc.kind}`)}</p>
          <p className="font-mono">{doc.number}</p>
          {doc.status === "VOID" ? <p className="mt-1 font-semibold text-red-700 uppercase">{t("finance.invoices.statuses.VOID")}</p> : null}
          {doc.status === "PAID" ? <p className="mt-1 font-semibold text-green-700 uppercase">{t("finance.invoices.statuses.PAID")}</p> : null}
        </div>
      </header>
      <section className="grid gap-4 sm:grid-cols-2">
        <div>
          <p className="text-xs text-neutral-500 uppercase">{t("finance.document.billTo")}</p>
          <p className="font-medium">{doc.customer.name}</p>
          {doc.customer.address ? <p className="whitespace-pre-line text-neutral-700">{doc.customer.address}</p> : null}
          {doc.customer.email ? <p className="text-neutral-700">{doc.customer.email}</p> : null}
          {doc.customer.phone ? <p className="text-neutral-700">{doc.customer.phone}</p> : null}
        </div>
        <dl className="grid content-start gap-1 sm:justify-self-end">
          <div className="flex justify-between gap-6">
            <dt className="text-neutral-500">{t("finance.billing.issueDate")}</dt>
            <dd>{day(doc.issueDate)}</dd>
          </div>
          {doc.dueDate ? (
            <div className="flex justify-between gap-6">
              <dt className="text-neutral-500">{t("finance.billing.dueDate")}</dt>
              <dd>{day(doc.dueDate)}</dd>
            </div>
          ) : null}
          {doc.expiryDate ? (
            <div className="flex justify-between gap-6">
              <dt className="text-neutral-500">{t("finance.billing.expiryDate")}</dt>
              <dd>{day(doc.expiryDate)}</dd>
            </div>
          ) : null}
        </dl>
      </section>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-neutral-300 text-start text-xs text-neutral-500 uppercase">
              <th className="py-2 text-start font-medium">{t("finance.fields.description")}</th>
              <th className="py-2 text-end font-medium">{t("finance.billing.qty")}</th>
              <th className="py-2 text-end font-medium">{t("finance.billing.unitPrice")}</th>
              <th className="py-2 text-end font-medium">{t("finance.billing.discountPct")}</th>
              <th className="py-2 text-end font-medium">{t("finance.billing.tax")}</th>
              <th className="py-2 text-end font-medium">{t("finance.billing.amount")}</th>
            </tr>
          </thead>
          <tbody>
            {doc.lines.map((l) => (
              <tr key={l.id} className="border-b border-neutral-200 align-top">
                <td className="py-2 pe-2 whitespace-pre-line">{l.description}</td>
                <td className="py-2 text-end tabular-nums">{new Intl.NumberFormat(locale, { maximumFractionDigits: 3 }).format(l.quantityMilli / 1000)}</td>
                <td className="py-2 text-end tabular-nums">{money(l.unitPriceMinor)}</td>
                <td className="py-2 text-end tabular-nums">{l.discountBps ? `${l.discountBps / 100}%` : "—"}</td>
                <td className="py-2 text-end tabular-nums">{l.taxBps ? `${l.taxBps / 100}%${l.taxInclusive ? "*" : ""}` : "—"}</td>
                <td className="py-2 text-end tabular-nums">{money(l.totalMinor)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <dl className="ms-auto grid w-full max-w-xs gap-1">
        <div className="flex justify-between">
          <dt className="text-neutral-500">{t("finance.billing.subtotal")}</dt>
          <dd className="tabular-nums">{money(doc.subtotalMinor)}</dd>
        </div>
        {doc.discountMinor ? (
          <div className="flex justify-between">
            <dt className="text-neutral-500">{t("finance.billing.discount")}</dt>
            <dd className="tabular-nums">−{money(doc.discountMinor)}</dd>
          </div>
        ) : null}
        <div className="flex justify-between">
          <dt className="text-neutral-500">{anyInclusive ? t("finance.document.taxIncluded") : t("finance.billing.tax")}</dt>
          <dd className="tabular-nums">{money(doc.taxMinor)}</dd>
        </div>
        <div className="flex justify-between border-t border-neutral-300 pt-1 text-base font-semibold">
          <dt>{t("finance.billing.total")}</dt>
          <dd className="tabular-nums">{money(doc.totalMinor)}</dd>
        </div>
        {doc.kind === "invoice" && doc.paidMinor ? (
          <div className="flex justify-between">
            <dt className="text-neutral-500">{t("finance.invoices.paid")}</dt>
            <dd className="tabular-nums">−{money(doc.paidMinor)}</dd>
          </div>
        ) : null}
        {doc.kind === "invoice" && doc.creditedMinor ? (
          <div className="flex justify-between">
            <dt className="text-neutral-500">{t("finance.invoices.credited")}</dt>
            <dd className="tabular-nums">−{money(doc.creditedMinor)}</dd>
          </div>
        ) : null}
        {doc.kind === "invoice" && doc.balanceMinor !== undefined ? (
          <div className="flex justify-between font-semibold">
            <dt>{t("finance.invoices.balanceDue")}</dt>
            <dd className="tabular-nums">{money(doc.balanceMinor)}</dd>
          </div>
        ) : null}
        {anyInclusive ? <p className="text-xs text-neutral-500">* {t("finance.document.inclusiveNote")}</p> : null}
      </dl>
      {doc.notes ? (
        <section>
          <p className="text-xs text-neutral-500 uppercase">{t("finance.fields.notes")}</p>
          <p className="whitespace-pre-line">{doc.notes}</p>
        </section>
      ) : null}
      {doc.terms ? (
        <section>
          <p className="text-xs text-neutral-500 uppercase">{t("finance.billing.terms")}</p>
          <p className="whitespace-pre-line">{doc.terms}</p>
        </section>
      ) : null}
      {doc.footer ? <footer className="border-t border-neutral-200 pt-3 text-xs whitespace-pre-line text-neutral-600">{doc.footer}</footer> : null}
    </article>
  );
}

/** Print CSS: only the document is printed. */
export function PrintStyles() {
  return (
    <style>{`@media print { body * { visibility: hidden !important; } #fin-print, #fin-print * { visibility: visible !important; } #fin-print { position: absolute; inset: 0; margin: 0; max-width: none; } @page { margin: 16mm; } }`}</style>
  );
}
