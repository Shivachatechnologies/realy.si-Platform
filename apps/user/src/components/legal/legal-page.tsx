import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { TriangleAlert } from "lucide-react";
import { CmsPage } from "@/components/cms/cms-page";
import { SiteContainer } from "@/components/site/section";
import { siteMetadata } from "@/components/site/meta";
import { getLocale, getT } from "@/i18n/server";
import { formatDate } from "@/i18n/format";
import { getPublishedPage } from "@/server/modules/cms/public";
import { LEGAL_CONTENT, LEGAL_DRAFT_DATE, type LegalDoc, type LegalSection } from "./content";

/**
 * Public legal page. A published CMS entry with the slug `legal-<doc>` (Admin → Content) replaces the built-in text —
 * that is how the reviewed, final wording goes live without a deploy. Until then the built-in DRAFT (./content.ts) is
 * shown under a clear "must be reviewed by a lawyer" banner.
 */
const cmsSlug = (doc: LegalDoc) => `legal-${doc}`;

export async function legalMetadata(doc: LegalDoc): Promise<Metadata> {
  const locale = await getLocale();
  const t = await getT(locale);
  const page = await getPublishedPage(cmsSlug(doc), locale);
  return siteMetadata({
    locale,
    path: `/legal/${doc}`,
    title: page ? page.variant.seoTitle || page.variant.title : t(`legal.docs.${doc}.title`),
    description: page ? page.variant.seoDescription || page.variant.summary : t(`legal.docs.${doc}.description`),
  });
}

/** **bold** and [label](/path) — the only inline syntax the built-in texts use. Paths get the locale prefix. */
function inline(text: string, locale: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*\*([^*]+)\*\*|\[([^\]]+)\]\((\/[^)\s]*)\)/g;
  let last = 0;
  let i = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1]) out.push(<strong key={i++}>{m[1]}</strong>);
    else
      out.push(
        <Link key={i++} href={`/${locale}${m[3]}`} className="font-medium text-primary underline underline-offset-4">
          {m[2]}
        </Link>,
      );
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function Section({ s, locale }: { s: LegalSection; locale: string }) {
  return (
    <section className="grid gap-3">
      <h2 className="font-display text-xl font-semibold tracking-tight">{s.heading}</h2>
      {s.paragraphs?.map((p, i) => <p key={i}>{inline(p, locale)}</p>)}
      {s.bullets?.length ? (
        <ul className="grid list-disc gap-1.5 ps-5">
          {s.bullets.map((b, i) => (
            <li key={i}>{inline(b, locale)}</li>
          ))}
        </ul>
      ) : null}
      {s.after?.map((p, i) => <p key={i}>{inline(p, locale)}</p>)}
    </section>
  );
}

export async function LegalPage({ doc }: { doc: LegalDoc }) {
  const locale = await getLocale();
  const t = await getT(locale);
  const page = await getPublishedPage(cmsSlug(doc), locale);
  if (page) return <CmsPage variant={page.variant} media={page.media} locale={page.locale} isPost={false} />;

  const content = LEGAL_CONTENT[doc];
  return (
    <SiteContainer className="grid max-w-3xl gap-8 py-12 sm:py-16">
      <div role="note" className="flex items-start gap-3 rounded-xl border border-warning/40 bg-warning/10 p-4 text-[14px] leading-relaxed">
        <TriangleAlert className="mt-0.5 size-5 shrink-0 text-warning" aria-hidden />
        <div className="grid gap-1">
          <p className="font-semibold">{t("legal.draftBanner")}</p>
          <p className="text-muted-foreground">{t("legal.draftHelp")}</p>
        </div>
      </div>
      <header className="grid gap-3">
        <p className="eyebrow-rule">{t("legal.eyebrow")}</p>
        <h1 className="font-display text-4xl font-semibold tracking-tight text-balance">{t(`legal.docs.${doc}.title`)}</h1>
        <p className="text-xs text-muted-foreground">
          {t("legal.lastUpdated", { date: formatDate(LEGAL_DRAFT_DATE, locale, "UTC", { dateStyle: "long" }) })}
          {locale !== "en-US" ? ` · ${t("legal.englishOnly")}` : ""}
        </p>
      </header>
      <div lang="en" dir="ltr" className="grid gap-8 text-[15px] leading-relaxed">
        <p className="text-[16px]">{content.intro}</p>
        {content.sections.map((s) => (
          <Section key={s.heading} s={s} locale={locale} />
        ))}
      </div>
    </SiteContainer>
  );
}
