"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowRight, Search } from "lucide-react";
import { useI18n } from "@/i18n/client";

export interface FaqItem {
  id: string;
  q: string;
  a: string;
  doc: { href: string; title: string } | null;
}

/** Help-center questions with instant search (client-side filter over the translated text). */
export function HelpFaq({ items }: { items: FaqItem[] }) {
  const { t, locale } = useI18n();
  const [q, setQ] = useState("");
  const shown = useMemo(() => {
    const needle = q.trim().toLocaleLowerCase(locale);
    return needle ? items.filter((i) => `${i.q} ${i.a}`.toLocaleLowerCase(locale).includes(needle)) : items;
  }, [q, items, locale]);
  return (
    <div className="grid gap-6">
      <div role="search" className="flex items-center gap-3 rounded-full border bg-surface px-5 shadow-elev-2 focus-within:border-ring">
        <Search className="size-5 shrink-0 text-muted-foreground" aria-hidden />
        <label htmlFor="help-search" className="sr-only">
          {t("site.help.search")}
        </label>
        <input
          id="help-search"
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("site.help.search")}
          className="min-h-14 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground"
        />
      </div>
      <p className="sr-only" aria-live="polite">
        {t("site.help.results", { count: shown.length })}
      </p>
      {shown.length === 0 ? (
        <p className="rounded-2xl border border-dashed p-8 text-center text-muted-foreground">{t("site.help.noResults")}</p>
      ) : (
        <div className="grid divide-y border-y">
          {shown.map((i) => (
            <details key={i.id} className="group py-2" open={q.trim().length > 0 && shown.length <= 3}>
              <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-4 text-[15.5px] font-medium [&::-webkit-details-marker]:hidden">
                {i.q}
                <span aria-hidden className="text-xl text-muted-foreground transition-transform group-open:rotate-45">
                  +
                </span>
              </summary>
              <div className="grid gap-3 pb-4">
                <p className="text-[14.5px] leading-relaxed text-muted-foreground">{i.a}</p>
                {i.doc ? (
                  <Link href={i.doc.href} className="inline-flex min-h-11 items-center gap-1.5 justify-self-start text-[13.5px] font-medium text-primary hover:underline">
                    {t("site.help.readGuide", { title: i.doc.title })}
                    <ArrowRight className="size-4 rtl:-scale-x-100" aria-hidden />
                  </Link>
                ) : null}
              </div>
            </details>
          ))}
        </div>
      )}
    </div>
  );
}
