import Link from "next/link";
import type { ReactNode } from "react";
import { headers } from "next/headers";
import type { CmsBlock, CmsVariant } from "@/server/modules/cms/schemas";
import { PricingPlans, type PublicPlan } from "@/components/site/pricing-plans";
import { SiteContainer } from "@/components/site/section";
import { db } from "@/server/core/db";
import { getPublicPricing } from "@/server/modules/pricing/service";

/**
 * Server renderer for published CMS pages (Admin → Content). Text uses a tiny inline syntax rendered as React
 * elements — never raw HTML — so content is sanitized by construction; links are limited to paths and http(s).
 */

const SAFE = /^(\/(?!\/)[^\s]*|https?:\/\/[^\s]+)$/i;

function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*\*([^*]+)\*\*|\*([^*]+)\*|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0;
  let i = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1]) out.push(<strong key={i++}>{m[1]}</strong>);
    else if (m[2]) out.push(<em key={i++}>{m[2]}</em>);
    else if (m[3] && m[4] && SAFE.test(m[4]))
      out.push(
        <a key={i++} href={m[4]} className="font-medium text-primary underline underline-offset-4" rel={m[4].startsWith("/") ? undefined : "noreferrer noopener"}>
          {m[3]}
        </a>,
      );
    else out.push(m[0]);
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function RichText({ body, className }: { body: string; className?: string }) {
  return (
    <div className={className ?? "grid gap-4 text-[15px] leading-relaxed"}>
      {body
        .split(/\n{2,}/)
        .filter((b) => b.trim())
        .map((b, i) => {
          const lines = b.split("\n");
          if (lines.every((l) => /^\s*[-*] /.test(l)))
            return (
              <ul key={i} className="grid list-disc gap-1 ps-5">
                {lines.map((l, j) => (
                  <li key={j}>{inline(l.replace(/^\s*[-*] /, ""))}</li>
                ))}
              </ul>
            );
          if (/^### /.test(b)) return <h3 key={i} className="text-lg font-semibold">{inline(b.slice(4))}</h3>;
          if (/^## /.test(b)) return <h2 key={i} className="font-display text-2xl font-semibold tracking-tight">{inline(b.slice(3))}</h2>;
          return (
            <p key={i}>
              {lines.map((l, j) => (
                <span key={j}>
                  {j > 0 ? <br /> : null}
                  {inline(l)}
                </span>
              ))}
            </p>
          );
        })}
    </div>
  );
}

const toClient = <T,>(v: T): T => JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x)));

/** Live pricing (the same resolver as /pricing): prices are never copied into page content. */
async function Pricing({ locale }: { locale: string }) {
  const h = await headers();
  const codes = (await db().country.findMany({ where: { status: "ACTIVE", billingEnabled: true }, select: { code: true } }).catch(() => [] as { code: string }[])).map((c) => c.code);
  const hint = h.get("x-vercel-ip-country") ?? h.get("cf-ipcountry") ?? locale.split("-")[1] ?? "US";
  const initialCountry = codes.includes(hint) ? hint : codes.includes("US") ? "US" : (codes[0] ?? "US");
  const initial = await getPublicPricing(initialCountry, "MONTH")
    .then((plans) => toClient({ plans }) as { plans: PublicPlan[] })
    .catch(() => null);
  return <PricingPlans countryCodes={codes.length ? codes : [initialCountry]} initialCountry={initialCountry} initial={initial} />;
}

const imgSrc = (ref: string, media: Record<string, string>) => (ref.startsWith("media:") ? (media[ref] ?? null) : /^https:\/\//.test(ref) ? ref : null);
const Cta = ({ href, label, inverse }: { href: string; label: string; inverse?: boolean }) =>
  href && SAFE.test(href) ? (
    <Link href={href} className={inverse ? "inline-flex h-11 w-fit items-center rounded-xl bg-white px-5 text-sm font-semibold text-[#0b4fe6] hover:bg-white/90" : "inline-flex h-11 w-fit items-center rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground hover:bg-primary/90"}>
      {label}
    </Link>
  ) : null;

function Block({ b, media, locale }: { b: CmsBlock; media: Record<string, string>; locale: string }) {
  switch (b.type) {
    case "hero": {
      const src = imgSrc(b.image, media);
      return (
        <section className="bg-[linear-gradient(135deg,#2f78ff,#0b4fe6)] text-white">
          <SiteContainer className="grid gap-8 py-16 sm:py-20 lg:grid-cols-[1.2fr_1fr] lg:items-center">
            <div className="grid gap-4">
              {b.eyebrow ? <span className="text-xs font-semibold tracking-[0.14em] uppercase opacity-80">{b.eyebrow}</span> : null}
              <h1 className="font-display text-4xl leading-tight font-bold tracking-tight text-balance sm:text-5xl">{b.title}</h1>
              {b.subtitle ? <p className="max-w-xl text-lg opacity-90">{b.subtitle}</p> : null}
              {b.ctaLabel ? <Cta href={b.ctaHref} label={b.ctaLabel} inverse /> : null}
            </div>
            {src ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={src} alt="" className="w-full rounded-2xl object-cover shadow-2xl" />
            ) : null}
          </SiteContainer>
        </section>
      );
    }
    case "features":
      return (
        <SiteContainer className="grid gap-6 py-12">
          {b.title ? <h2 className="font-display text-3xl font-semibold tracking-tight">{b.title}</h2> : null}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {b.items.map((it, i) => (
              <div key={i} className="rounded-2xl border bg-surface p-5">
                <h3 className="font-semibold">{it.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{inline(it.body)}</p>
              </div>
            ))}
          </div>
        </SiteContainer>
      );
    case "richText":
      return (
        <SiteContainer className="max-w-3xl py-8">
          <RichText body={b.body} />
        </SiteContainer>
      );
    case "image": {
      const src = imgSrc(b.image, media);
      if (!src) return null;
      return (
        <SiteContainer className="py-8">
          <figure className="grid gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={src} alt={b.alt} className="w-full rounded-2xl border object-cover" loading="lazy" />
            {b.caption ? <figcaption className="text-sm text-muted-foreground">{b.caption}</figcaption> : null}
          </figure>
        </SiteContainer>
      );
    }
    case "cta":
      return (
        <SiteContainer className="py-10">
          <div className="flex flex-wrap items-center justify-between gap-6 rounded-3xl border bg-accent p-8">
            <div className="grid gap-2">
              <h2 className="font-display text-2xl font-semibold tracking-tight">{b.title}</h2>
              {b.body ? <p className="text-muted-foreground">{b.body}</p> : null}
            </div>
            {b.ctaLabel ? <Cta href={b.ctaHref} label={b.ctaLabel} /> : null}
          </div>
        </SiteContainer>
      );
    case "faq":
      return (
        <SiteContainer className="grid gap-6 py-12 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
          {b.title ? <h2 className="font-display text-3xl font-semibold tracking-tight">{b.title}</h2> : <span />}
          <div className="grid divide-y border-y">
            {b.items.map((it, i) => (
              <details key={i} className="group py-2">
                <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-4 text-[15px] font-medium [&::-webkit-details-marker]:hidden">
                  {it.q}
                  <span aria-hidden className="text-xl text-muted-foreground transition-transform group-open:rotate-45">
                    +
                  </span>
                </summary>
                <RichText body={it.a} className="grid gap-3 pb-4 text-[14px] leading-relaxed text-muted-foreground" />
              </details>
            ))}
          </div>
        </SiteContainer>
      );
    case "pricing":
      return (
        <SiteContainer className="grid gap-8 py-12">
          {b.title || b.subtitle ? (
            <div className="grid gap-2">
              {b.title ? <h2 className="font-display text-3xl font-semibold tracking-tight">{b.title}</h2> : null}
              {b.subtitle ? <p className="text-muted-foreground">{b.subtitle}</p> : null}
            </div>
          ) : null}
          <Pricing locale={locale} />
        </SiteContainer>
      );
  }
}

export function CmsPage({ variant, media, locale, isPost, publishedLabel }: { variant: CmsVariant; media: Record<string, string>; locale: string; isPost: boolean; publishedLabel?: string }) {
  const startsWithHero = variant.blocks[0]?.type === "hero";
  return (
    <article lang={locale} className="pb-16">
      {!startsWithHero ? (
        <SiteContainer className={isPost ? "max-w-3xl pt-14 pb-4" : "pt-14 pb-4"}>
          <h1 className="font-display text-4xl font-bold tracking-tight text-balance sm:text-5xl">{variant.title}</h1>
          {variant.summary ? <p className="mt-4 max-w-2xl text-lg text-muted-foreground">{variant.summary}</p> : null}
          {publishedLabel ? <p className="mt-3 text-sm text-muted-foreground">{publishedLabel}</p> : null}
        </SiteContainer>
      ) : null}
      {variant.blocks.map((b) => (
        <Block key={b.id} b={b} media={media} locale={locale} />
      ))}
    </article>
  );
}
