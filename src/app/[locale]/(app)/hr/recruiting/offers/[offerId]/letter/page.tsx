import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PrintButton } from "@/components/hr/hr-action";
import { HrFrame, loadHr, personName } from "@/components/hr/shell";
import { formatDate, formatMoney } from "@/i18n/format";
import { getLocale, getT } from "@/i18n/server";
import { isAppError } from "@/server/core/errors";
import { getOfferLetter } from "@/server/modules/hr/recruiting";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("hr.recruiting.offerLetter") };
}

/** Printable offer letter (browser print → PDF). */
export default async function OfferLetterPage({ params }: { params: Promise<{ offerId: string }> }) {
  const { offerId } = await params;
  const locale = await getLocale();
  const { t, viewer, org, company, access, tz } = await loadHr(locale);
  const allowed = !!access?.manage;
  if (!company || !allowed) return <HrFrame t={t} locale={locale} title={t("hr.recruiting.offerLetter")} tab="recruiting" access={access} hasCompany={!!company} allowed={allowed}>{null}</HrFrame>;
  const o = await getOfferLetter(viewer.ctx, org.id, company.id, offerId).catch((err) => {
    if (isAppError(err) && err.code === "not_found") notFound();
    throw err;
  });
  const companyName = o.company.legalName || o.company.name;
  const name = personName(o.candidate);
  return (
    <div className="mx-auto grid max-w-3xl gap-4">
      <div className="flex items-center justify-between gap-2 print:hidden">
        <Link href={`/${locale}/hr/recruiting/candidates/${o.candidate.id}`} className="text-sm text-muted-foreground hover:underline">
          {t("hr.recruiting.backToCandidate")}
        </Link>
        <PrintButton label={t("hr.print")} />
      </div>
      <article className="grid gap-4 rounded-lg border bg-white p-10 text-[15px] leading-relaxed text-black print:border-0 print:p-0">
        <header className="flex items-start justify-between gap-4">
          <h1 className="text-xl font-semibold">{companyName}</h1>
          <span>{formatDate(o.sentAt ?? new Date(), locale, tz, { dateStyle: "long" })}</span>
        </header>
        <p>{t("hr.letter.dear", { name })}</p>
        <p>{t("hr.letter.intro", { company: companyName, title: o.title })}</p>
        <ul className="grid gap-1 ps-5" style={{ listStyle: "disc" }}>
          <li>{t("hr.letter.position", { title: o.title })}</li>
          {o.candidate.job.department ? <li>{t("hr.letter.department", { department: o.candidate.job.department.name })}</li> : null}
          <li>{t("hr.letter.type", { type: t(`hr.employmentType.${o.candidate.job.employmentType}`) })}</li>
          {o.candidate.job.location ? <li>{t("hr.letter.location", { location: o.candidate.job.location })}</li> : null}
          <li>{t("hr.letter.salary", { amount: formatMoney({ amountMinor: o.salaryMinor, currency: o.currency }, locale) })}</li>
          {o.startDate ? <li>{t("hr.letter.start", { date: formatDate(o.startDate, locale, "UTC", { dateStyle: "long" }) })}</li> : null}
        </ul>
        {o.terms ? <p className="whitespace-pre-wrap">{o.terms}</p> : null}
        <p>{t("hr.letter.closing")}</p>
        <div className="mt-8 grid grid-cols-2 gap-10">
          <div className="border-t pt-2 text-sm">{t("hr.letter.forCompany", { company: companyName })}</div>
          <div className="border-t pt-2 text-sm">{t("hr.letter.accepted", { name })}</div>
        </div>
      </article>
    </div>
  );
}
