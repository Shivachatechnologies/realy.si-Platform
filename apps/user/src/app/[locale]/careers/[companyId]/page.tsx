import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BrandMark } from "@/components/brand";
import { LanguageSwitcher } from "@/components/language-switcher";
import { Badge } from "@/components/ui/badge";
import { getLocale, getT } from "@/i18n/server";
import { formatDate } from "@/i18n/format";
import { publicCompany, publicJobs } from "@/server/modules/hr/careers";

export async function generateMetadata({ params }: { params: Promise<{ companyId: string }> }): Promise<Metadata> {
  const { companyId } = await params;
  const company = await publicCompany(companyId);
  const t = await getT();
  return { title: company ? t("hr.careers.titleFor", { company: company.name }) : t("hr.careers.title") };
}

/** Public careers page: a company's open jobs (no sign-in). */
export default async function CareersPage({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const locale = await getLocale();
  const t = await getT(locale);
  const company = await publicCompany(companyId);
  if (!company) notFound();
  const jobs = await publicJobs(companyId);
  return (
    <div className="min-h-dvh bg-background">
      <header className="flex items-center justify-between border-b px-6 py-4">
        <span className="flex items-center gap-2 font-semibold tracking-tight">
          <BrandMark />
          {company.name}
        </span>
        <LanguageSwitcher />
      </header>
      <main className="mx-auto grid max-w-3xl gap-6 px-4 py-10">
        <div className="grid gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">{t("hr.careers.titleFor", { company: company.name })}</h1>
          <p className="text-muted-foreground">{t("hr.careers.intro", { count: jobs.length })}</p>
        </div>
        {jobs.length ? (
          <ul className="grid gap-3">
            {jobs.map((j) => (
              <li key={j.id}>
                <Link href={`/${locale}/careers/${company.id}/${j.id}`} className="grid gap-1 rounded-lg border bg-surface p-4 hover:bg-muted/50">
                  <span className="text-base font-medium">{j.title}</span>
                  <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    {j.department ? <Badge>{j.department.name}</Badge> : null}
                    <span>{t(`hr.employmentType.${j.employmentType}`)}</span>
                    {j.location ? <span>{j.location}</span> : null}
                    {j.remote ? <Badge tone="accent">{t("hr.recruiting.remote")}</Badge> : null}
                    {j.publishedAt ? <span>{formatDate(j.publishedAt, locale, company.timezone)}</span> : null}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-lg border bg-surface p-6 text-center text-muted-foreground">{t("hr.careers.noJobs")}</p>
        )}
        <p className="text-center text-xs text-muted-foreground">{t("hr.careers.poweredBy")}</p>
      </main>
    </div>
  );
}
