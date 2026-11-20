import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BrandMark } from "@/components/brand";
import { LanguageSwitcher } from "@/components/language-switcher";
import { Badge } from "@/components/ui/badge";
import { HrForm } from "@/components/hr/hr-form";
import { formatMoney } from "@/i18n/format";
import { getLocale, getT } from "@/i18n/server";
import { publicCompany, publicJob } from "@/server/modules/hr/careers";
import { MAX_RESUME_BYTES } from "@/server/modules/hr/recruiting";

export async function generateMetadata({ params }: { params: Promise<{ companyId: string; jobId: string }> }): Promise<Metadata> {
  const { companyId, jobId } = await params;
  const [company, job] = await Promise.all([publicCompany(companyId), publicJob(companyId, jobId)]);
  return { title: job && company ? `${job.title} · ${company.name}` : (await getT())("hr.careers.title") };
}

/** Public job page with the application form (resume PDF ≤ 5 MB). */
export default async function PublicJobPage({ params }: { params: Promise<{ companyId: string; jobId: string }> }) {
  const { companyId, jobId } = await params;
  const locale = await getLocale();
  const t = await getT(locale);
  const [company, job] = await Promise.all([publicCompany(companyId), publicJob(companyId, jobId)]);
  if (!company || !job) notFound();
  const money = (m: bigint | null) => (m == null ? null : formatMoney({ amountMinor: m, currency: job.currency }, locale));
  const salary = [money(job.salaryMinMinor), money(job.salaryMaxMinor)].filter(Boolean).join(" – ");
  return (
    <div className="min-h-dvh bg-background">
      <header className="flex items-center justify-between border-b px-6 py-4">
        <Link href={`/${locale}/careers/${company.id}`} className="flex items-center gap-2 font-semibold tracking-tight">
          <BrandMark />
          {company.name}
        </Link>
        <LanguageSwitcher />
      </header>
      <main className="mx-auto grid max-w-3xl gap-6 px-4 py-10">
        <Link href={`/${locale}/careers/${company.id}`} className="text-sm text-muted-foreground hover:underline">
          {t("hr.careers.allJobs")}
        </Link>
        <div className="grid gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">{job.title}</h1>
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            {job.department ? <Badge>{job.department.name}</Badge> : null}
            <span>{t(`hr.employmentType.${job.employmentType}`)}</span>
            {job.location ? <span>{job.location}</span> : null}
            {job.remote ? <Badge tone="accent">{t("hr.recruiting.remote")}</Badge> : null}
            {salary ? <span>{salary}</span> : null}
          </div>
        </div>
        {job.description ? <div className="whitespace-pre-wrap leading-relaxed">{job.description}</div> : null}
        <section className="grid gap-3 rounded-lg border bg-surface p-5">
          <h2 className="text-lg font-semibold">{t("hr.careers.apply")}</h2>
          <HrForm
            endpoint={`/api/v1/public/careers/${company.id}/jobs/${job.id}/apply`}
            fields={[
              { name: "firstName", label: t("hr.firstName"), required: true, maxLength: 100 },
              { name: "lastName", label: t("hr.lastName"), maxLength: 100 },
              { name: "email", label: t("hr.email"), type: "email", required: true },
              { name: "phone", label: t("hr.phone"), type: "tel" },
              { name: "linkedinUrl", label: t("hr.recruiting.linkedin"), type: "url", full: true },
              { name: "resume", label: t("hr.careers.resume"), type: "file", required: true, accept: ".pdf,application/pdf", maxBytes: MAX_RESUME_BYTES, hint: t("hr.careers.resumeHint"), full: true },
              { name: "coverLetter", label: t("hr.recruiting.coverLetter"), type: "textarea", rows: 5 },
              { name: "consent", label: t("hr.careers.consentLabel"), type: "checkbox", hint: t("hr.careers.consent", { company: company.name }), full: true },
            ]}
            submitLabel={t("hr.careers.submit")}
            successMessage={t("hr.careers.thanks")}
          />
        </section>
      </main>
    </div>
  );
}
