import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight, BookOpen, LifeBuoy, Mail } from "lucide-react";
import { World } from "@/components/ui/world";
import { HelpFaq, type FaqItem } from "@/components/site/help-faq";
import { SiteContainer, SiteHeading } from "@/components/site/section";
import { JsonLd } from "@/components/site/json-ld";
import { siteMetadata } from "@/components/site/meta";
import { getLocale, getT } from "@/i18n/server";
import { DOC_ARTICLES, HELP_FAQ } from "@/server/modules/site/content";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  const t = await getT(locale);
  return siteMetadata({ locale, path: "/help", title: t("site.help.title"), description: t("site.help.lede") });
}

/** Help center for visitors and customers: searchable answers, links into the docs and where to get a person. */
export default async function HelpCenterPage() {
  const locale = await getLocale();
  const t = await getT(locale);
  const items: FaqItem[] = HELP_FAQ.map((f) => {
    const doc = f.doc ? DOC_ARTICLES.find((a) => a.slug === f.doc) : null;
    return {
      id: f.id,
      q: t(`site.help.faq.${f.id}.q`),
      a: t(`site.help.faq.${f.id}.a`),
      doc: doc ? { href: `/${locale}/docs/${doc.slug}`, title: t(`site.docs.articles.${doc.id}.title`) } : null,
    };
  });
  const paths = [
    { icon: BookOpen, title: t("site.help.paths.docs.title"), body: t("site.help.paths.docs.body"), href: `/${locale}/docs` },
    { icon: LifeBuoy, title: t("site.help.paths.inApp.title"), body: t("site.help.paths.inApp.body"), href: `/${locale}/sign-in` },
    { icon: Mail, title: t("site.help.paths.contact.title"), body: t("site.help.paths.contact.body"), href: `/${locale}/waitlist` },
  ];
  return (
    <World name="support" ambient={false}>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "FAQPage",
          mainEntity: items.map((i) => ({ "@type": "Question", name: i.q, acceptedAnswer: { "@type": "Answer", text: i.a } })),
        }}
      />
      <section className="relative overflow-hidden">
        <div aria-hidden className="site-hero-light pointer-events-none absolute inset-0 -z-10" />
        <SiteContainer className="grid max-w-3xl gap-10 pt-14 pb-14 sm:pt-20">
          <SiteHeading as="h1" eyebrow={t("site.help.eyebrow")} title={t("site.help.title")} lede={t("site.help.lede")} />
          <HelpFaq items={items} />
        </SiteContainer>
      </section>
      <section className="border-t py-16">
        <SiteContainer className="grid gap-4 md:grid-cols-3">
          {paths.map(({ icon: Icon, title, body, href }) => (
            <Link key={title} href={href} className="group grid content-start gap-3 rounded-3xl border bg-surface p-6 transition-colors hover:bg-muted/40">
              <Icon className="size-5 text-primary" aria-hidden />
              <h2 className="text-[16px] font-semibold">{title}</h2>
              <p className="text-[14px] leading-relaxed text-muted-foreground">{body}</p>
              <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 rtl:-scale-x-100" aria-hidden />
            </Link>
          ))}
        </SiteContainer>
      </section>
    </World>
  );
}
