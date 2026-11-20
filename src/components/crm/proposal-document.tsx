import { Markdownish } from "@/components/comms/markdownish";
import { formatDate, formatMoney, formatNumber } from "@/i18n/format";

/** The rendered proposal (in-app preview, print page and public share page). `#crm-print` is what gets printed. */

export interface ProposalDocData {
  number: string;
  title: string;
  version: number;
  currency: string;
  intro: string;
  scope: string;
  timeline: string;
  terms: string;
  validUntil: Date | null;
  createdAt: Date;
  subtotalMinor: bigint;
  discountMinor: bigint;
  taxMinor: bigint;
  totalMinor: bigint;
  lines: { id: string; description: string; quantityMilli: number; unitPriceMinor: bigint; discountBps: number; taxBps: number; totalMinor: bigint }[];
  companyName: string;
  customerName: string | null;
  customerAddress: string | null;
  contactName: string | null;
}

type T = (key: string, vars?: Record<string, string | number>) => string;

export function ProposalDocument({ doc, t, locale, printable = true }: { doc: ProposalDocData; t: T; locale: string; printable?: boolean }) {
  const money = (v: bigint) => formatMoney({ amountMinor: v, currency: doc.currency }, locale);
  const sections = (["intro", "scope", "timeline", "terms"] as const).filter((k) => doc[k].trim());
  return (
    <article id={printable ? "crm-print" : undefined} className="mx-auto grid w-full max-w-3xl gap-6 rounded-lg border bg-white p-6 text-sm text-black sm:p-10 print:border-0 print:p-0">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-lg font-semibold">{doc.companyName}</p>
          <p className="text-neutral-600">{t("crm.proposals.document")}</p>
        </div>
        <div className="text-end text-neutral-700">
          <p className="font-medium">
            {doc.number} · v{doc.version}
          </p>
          <p>{formatDate(doc.createdAt, locale, "UTC")}</p>
          {doc.validUntil ? <p>{t("crm.proposals.validUntilDate", { date: formatDate(doc.validUntil, locale, "UTC") })}</p> : null}
        </div>
      </header>
      <div className="grid gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">{doc.title}</h1>
        {doc.customerName || doc.contactName ? (
          <p className="text-neutral-700">
            {t("crm.proposals.preparedFor")} {[doc.contactName, doc.customerName].filter(Boolean).join(", ")}
          </p>
        ) : null}
        {doc.customerAddress ? <p className="whitespace-pre-line text-neutral-600">{doc.customerAddress}</p> : null}
      </div>
      {sections.map((k) => (
        <section key={k} className="grid gap-2 break-inside-avoid-page">
          <h2 className="text-base font-semibold">{t(`crm.proposals.sections.${k}`)}</h2>
          <Markdownish text={doc[k]} className="grid gap-2 leading-relaxed" />
        </section>
      ))}
      {doc.lines.length ? (
        <section className="grid gap-2 break-inside-avoid-page">
          <h2 className="text-base font-semibold">{t("crm.proposals.pricing")}</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b text-xs text-neutral-600">
                <tr>
                  <th className="py-1.5 text-start font-medium">{t("crm.proposals.description")}</th>
                  <th className="py-1.5 text-end font-medium">{t("crm.proposals.quantity")}</th>
                  <th className="py-1.5 text-end font-medium">{t("crm.proposals.price")}</th>
                  <th className="py-1.5 text-end font-medium">{t("crm.proposals.discountPct")}</th>
                  <th className="py-1.5 text-end font-medium">{t("crm.proposals.taxPct")}</th>
                  <th className="py-1.5 text-end font-medium">{t("crm.proposals.amount")}</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {doc.lines.map((l) => (
                  <tr key={l.id}>
                    <td className="py-1.5 pe-2">{l.description}</td>
                    <td className="py-1.5 text-end tabular-nums">{formatNumber(l.quantityMilli / 1000, locale)}</td>
                    <td className="py-1.5 text-end tabular-nums">{money(l.unitPriceMinor)}</td>
                    <td className="py-1.5 text-end tabular-nums">{l.discountBps ? `${formatNumber(l.discountBps / 100, locale)}%` : "—"}</td>
                    <td className="py-1.5 text-end tabular-nums">{l.taxBps ? `${formatNumber(l.taxBps / 100, locale)}%` : "—"}</td>
                    <td className="py-1.5 text-end tabular-nums">{money(l.totalMinor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <dl className="ms-auto grid w-full max-w-xs grid-cols-2 gap-y-0.5 tabular-nums">
            <dt className="text-neutral-600">{t("crm.proposals.subtotal")}</dt>
            <dd className="text-end">{money(doc.subtotalMinor)}</dd>
            {doc.discountMinor > 0n ? (
              <>
                <dt className="text-neutral-600">{t("crm.proposals.discount")}</dt>
                <dd className="text-end">−{money(doc.discountMinor)}</dd>
              </>
            ) : null}
            <dt className="text-neutral-600">{t("crm.proposals.tax")}</dt>
            <dd className="text-end">{money(doc.taxMinor)}</dd>
            <dt className="border-t pt-1 font-semibold">{t("crm.proposals.total")}</dt>
            <dd className="border-t pt-1 text-end font-semibold">{money(doc.totalMinor)}</dd>
          </dl>
        </section>
      ) : null}
    </article>
  );
}

export function ProposalPrintStyles() {
  return (
    <style>{`@media print { body * { visibility: hidden !important; } #crm-print, #crm-print * { visibility: visible !important; } #crm-print { position: absolute; inset: 0; margin: 0; max-width: none; } @page { margin: 16mm; } }`}</style>
  );
}
