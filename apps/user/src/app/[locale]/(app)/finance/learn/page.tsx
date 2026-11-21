import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, BookOpen, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { financePage } from "@/components/finance/page-context";
import { GLOSSARY_GROUPS, GLOSSARY_HREF } from "@/components/finance/glossary";
import { getT } from "@/i18n/server";
import { param } from "@/server/modules/finance/common";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("finance.tabs.learn") };
}

/** Finance in plain words: every term Finance OS uses, with a one-line meaning, an everyday example and where to find it. */
export default async function FinanceLearnPage({ searchParams }: PageProps<"/[locale]/finance/learn">) {
  const p = await financePage("learn");
  if (p.blocked) return p.blocked;
  const { t, locale } = p;
  const q = (param(await searchParams, "q") ?? "").trim().toLowerCase().slice(0, 80);
  const groups = GLOSSARY_GROUPS.map((g) => ({
    key: g.key,
    terms: g.terms
      .map((k) => ({ key: k, term: t(`finance.glossary.terms.${k}.term`), short: t(`finance.glossary.terms.${k}.short`), example: t(`finance.glossary.terms.${k}.example`) }))
      .filter((x) => !q || `${x.term} ${x.short} ${x.example}`.toLowerCase().includes(q)),
  })).filter((g) => g.terms.length);
  const total = groups.reduce((s, g) => s + g.terms.length, 0);

  return p.frame(
    <div className="grid gap-6 lg:grid-cols-[14rem_minmax(0,1fr)]">
      <aside className="grid content-start gap-3 lg:sticky lg:top-20">
        <form action={`/${locale}/finance/learn`} className="flex gap-2" role="search">
          <label className="sr-only" htmlFor="glossary-q">
            {t("finance.glossary.search")}
          </label>
          <Input id="glossary-q" name="q" defaultValue={q} placeholder={t("finance.glossary.search")} className="min-w-0" />
          <Button type="submit" size="sm" variant="secondary" aria-label={t("finance.glossary.search")}>
            <Search aria-hidden />
          </Button>
        </form>
        <nav aria-label={t("finance.glossary.groupsLabel")} className="hidden gap-1 text-sm lg:grid">
          {groups.map((g) => (
            <a key={g.key} href={`#group-${g.key}`} className="rounded-md px-2 py-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
              {t(`finance.glossary.groups.${g.key}`)}
            </a>
          ))}
        </nav>
        <p className="rounded-lg border bg-surface p-3 text-xs leading-relaxed text-muted-foreground">
          <BookOpen aria-hidden className="mb-1 size-4 text-success" />
          {t("finance.glossary.tip")}
        </p>
      </aside>
      <div className="grid gap-8">
        {!total ? <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">{t("finance.glossary.noMatch")}</p> : null}
        {groups.map((g) => (
          <section key={g.key} id={`group-${g.key}`} aria-labelledby={`h-${g.key}`} className="grid gap-3 scroll-mt-24">
            <h2 id={`h-${g.key}`} className="font-display text-2xl">
              {t(`finance.glossary.groups.${g.key}`)}
            </h2>
            <dl className="stagger grid gap-3 md:grid-cols-2">
              {g.terms.map((x) => (
                <div key={x.key} id={x.key} className="reveal hover-lift grid scroll-mt-24 content-start gap-2 rounded-lg border bg-surface p-4 shadow-elev-1 target:ring-2 target:ring-success">
                  <dt className="font-semibold">{x.term}</dt>
                  <dd className="grid gap-2 text-sm">
                    <p>{x.short}</p>
                    <p className="rounded-md bg-success/5 px-3 py-2 text-muted-foreground">
                      <span className="me-1 text-[11px] font-semibold tracking-wide text-success uppercase">{t("finance.glossary.example")}</span>
                      {x.example}
                    </p>
                    {GLOSSARY_HREF[x.key] ? (
                      <Link href={`/${locale}/finance${GLOSSARY_HREF[x.key]}`} className="inline-flex items-center gap-1 justify-self-start text-xs font-medium text-primary hover:underline">
                        {t("finance.glossary.seeIt")}
                        <ArrowRight aria-hidden className="size-3 rtl:-scale-x-100" />
                      </Link>
                    ) : null}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </div>,
  );
}
