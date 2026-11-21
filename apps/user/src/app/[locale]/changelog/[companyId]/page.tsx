import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BrandMark } from "@/components/brand";
import { LanguageSwitcher } from "@/components/language-switcher";
import { getLocale, getT } from "@/i18n/server";
import { formatDate } from "@/i18n/format";
import { publicChangelog } from "@/server/modules/work/product";

export async function generateMetadata({ params }: PageProps<"/[locale]/changelog/[companyId]">): Promise<Metadata> {
  const { companyId } = await params;
  const t = await getT();
  const data = await publicChangelog(companyId);
  return { title: data ? t("work.changelog.title", { company: data.company.name }) : t("errors.notFoundTitle") };
}

/** Public changelog (no sign-in): only releases a company explicitly published. */
export default async function ChangelogPage({ params }: PageProps<"/[locale]/changelog/[companyId]">) {
  const { companyId } = await params;
  const locale = await getLocale();
  const t = await getT(locale);
  const data = await publicChangelog(companyId);
  if (!data) notFound();
  return (
    <div className="min-h-dvh">
      <header className="flex items-center justify-between px-6 py-4">
        <Link href={`/${locale}`} className="flex items-center gap-2 font-semibold tracking-tight">
          <BrandMark />
          <span>{t("common.appName")}</span>
        </Link>
        <LanguageSwitcher />
      </header>
      <main className="mx-auto grid max-w-3xl gap-8 px-4 py-8">
        <div className="grid gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">{t("work.changelog.title", { company: data.company.name })}</h1>
          <p className="text-muted-foreground">{t("work.changelog.subtitle")}</p>
        </div>
        {data.releases.length ? (
          <ol className="grid gap-8 border-s ps-6">
            {data.releases.map((r) => (
              <li key={r.id} className="relative grid gap-2">
                <span aria-hidden className="absolute -start-[1.85rem] top-1.5 size-3 rounded-full border-2 border-primary bg-surface" />
                <div className="flex flex-wrap items-baseline gap-2">
                  <h2 className="font-mono text-lg font-semibold">{r.version}</h2>
                  {r.name ? <span className="font-medium">{r.name}</span> : null}
                  <time className="text-sm text-muted-foreground">{formatDate(r.releaseDate ?? r.publishedAt!, locale, "UTC")}</time>
                </div>
                {r.features.length ? (
                  <ul className="grid list-disc gap-1 ps-5 text-sm">
                    {r.features.map((f) => (
                      <li key={f.id}>{f.title}</li>
                    ))}
                  </ul>
                ) : null}
                {r.notes ? <p className="whitespace-pre-wrap text-sm text-muted-foreground">{r.notes}</p> : null}
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-muted-foreground">{t("work.changelog.empty")}</p>
        )}
      </main>
    </div>
  );
}
