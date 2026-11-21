import type { CSSProperties, ReactNode } from "react";
import { Check, ChartNoAxesColumn, Clock, Globe, Heart, Quote, Shield, Sparkles, Star, Users, Zap, type LucideIcon } from "lucide-react";
import { contrastOn, resolveHref, SAFE_HREF, type FeatureIcon, type PageContent, type SiteBlock, type SiteBlockOf, type SiteFooter, type SiteNav, type SiteTheme } from "@/server/modules/sites/schemas";
import { SiteContactForm, type ContactFormLabels } from "./contact-form";

/**
 * Renderer for company website blocks — used by the public site (/s/<slug>, server-rendered) and by the editor's
 * live preview (client). Text uses a tiny inline syntax rendered as React elements — never raw HTML — and links are
 * limited to site paths, anchors, http(s), mailto: and tel:. Sites are always light themed with the company's brand
 * colour (CSS variables), independent of the app's own theme.
 */

export interface SiteRenderContext {
  /** Base path for site links ("/s/<slug>"). */
  base: string;
  theme: SiteTheme;
  /** Visual asset id → URL, or null when the image cannot be shown. */
  assetUrl: (assetId: string) => string | null;
  products: Record<string, { name: string; description: string }>;
  customers: Record<string, { name: string }>;
  /** live: working contact forms; preview: inert (the editor). */
  mode: "live" | "preview";
  form?: { siteSlug: string; pageId: string; labels: ContactFormLabels };
  labels: { menu: string; poweredBy: string; contactUs: string; customerOf: string };
}

const ICONS: Record<FeatureIcon, LucideIcon> = { sparkles: Sparkles, check: Check, shield: Shield, zap: Zap, heart: Heart, star: Star, clock: Clock, globe: Globe, users: Users, chart: ChartNoAxesColumn };
const FONT: Record<SiteTheme["font"], { body: string; heading: string }> = {
  modern: { body: "var(--font-inter), ui-sans-serif, system-ui, sans-serif", heading: "var(--font-inter), ui-sans-serif, system-ui, sans-serif" },
  display: { body: "var(--font-inter), ui-sans-serif, system-ui, sans-serif", heading: "var(--font-sora), var(--font-inter), ui-sans-serif, sans-serif" },
  classic: { body: "Georgia, 'Iowan Old Style', 'Times New Roman', serif", heading: "Georgia, 'Iowan Old Style', 'Times New Roman', serif" },
  mono: { body: "var(--font-inter), ui-sans-serif, system-ui, sans-serif", heading: "var(--font-geist-mono), ui-monospace, monospace" },
};
const RADIUS = { rounded: "1rem", square: "0.25rem", pill: "1.75rem" } as const;

/** CSS variables of a theme (applied on the site wrapper). */
export function themeStyle(theme: SiteTheme): CSSProperties {
  const f = FONT[theme.font];
  return {
    "--site-brand": theme.brandColor,
    "--site-brand-fg": contrastOn(theme.brandColor),
    "--site-accent": theme.accentColor,
    "--site-accent-fg": contrastOn(theme.accentColor),
    "--site-radius": RADIUS[theme.radius],
    "--site-heading": f.heading,
    fontFamily: f.body,
    colorScheme: "light",
  } as CSSProperties;
}

const H = "font-[family-name:var(--site-heading)] tracking-tight text-balance";
const Wrap = ({ children, className = "", id }: { children: ReactNode; className?: string; id?: string }) => (
  <section id={id} className={`mx-auto w-full max-w-6xl px-4 @2xl:px-6 ${className}`}>
    {children}
  </section>
);

function inline(text: string, base: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*\*([^*]+)\*\*|\*([^*]+)\*|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0;
  let i = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1]) out.push(<strong key={i++}>{m[1]}</strong>);
    else if (m[2]) out.push(<em key={i++}>{m[2]}</em>);
    else if (m[3] && m[4] && SAFE_HREF.test(m[4]))
      out.push(
        <a key={i++} href={resolveHref(m[4], base) ?? "#"} className="font-medium text-[var(--site-brand)] underline underline-offset-4" rel={/^https?:/i.test(m[4]) ? "noreferrer noopener" : undefined}>
          {m[3]}
        </a>,
      );
    else out.push(m[0]);
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function RichText({ body, base, className }: { body: string; base: string; className?: string }) {
  return (
    <div className={className ?? "grid gap-4 text-base leading-relaxed text-slate-700"}>
      {body
        .split(/\n{2,}/)
        .filter((b) => b.trim())
        .map((b, i) => {
          const lines = b.split("\n");
          if (lines.every((l) => /^\s*[-*] /.test(l)))
            return (
              <ul key={i} className="grid list-disc gap-1 ps-5">
                {lines.map((l, j) => (
                  <li key={j}>{inline(l.replace(/^\s*[-*] /, ""), base)}</li>
                ))}
              </ul>
            );
          if (/^### /.test(b)) return <h3 key={i} className={`${H} text-lg font-semibold text-slate-900`}>{inline(b.slice(4), base)}</h3>;
          if (/^## /.test(b)) return <h2 key={i} className={`${H} text-2xl font-semibold text-slate-900 @2xl:text-3xl`}>{inline(b.slice(3), base)}</h2>;
          return (
            <p key={i}>
              {lines.map((l, j) => (
                <span key={j}>
                  {j > 0 ? <br /> : null}
                  {inline(l, base)}
                </span>
              ))}
            </p>
          );
        })}
    </div>
  );
}

function Cta({ href, label, base, variant = "primary", preview }: { href: string; label: string; base: string; variant?: "primary" | "ghost" | "inverse"; preview: boolean }) {
  const to = resolveHref(href, base);
  if (!label || !to) return null;
  const cls = {
    primary: "bg-[var(--site-brand)] text-[var(--site-brand-fg)] shadow-[0_10px_30px_-12px_var(--site-brand)] hover:brightness-110",
    ghost: "border border-slate-300 bg-white/70 text-slate-900 hover:border-slate-400",
    inverse: "bg-white text-slate-900 hover:bg-white/90",
  }[variant];
  return (
    <a href={preview ? undefined : to} aria-disabled={preview || undefined} className={`inline-flex min-h-11 w-fit items-center justify-center rounded-[var(--site-radius)] px-5 text-sm font-semibold transition ${cls}`} rel={/^https?:/i.test(to) ? "noreferrer noopener" : undefined}>
      {label}
    </a>
  );
}

function Img({ ref_, r, alt, className, eager }: { ref_: string; r: SiteRenderContext; alt: string; className: string; eager?: boolean }) {
  const id = /^asset:/i.test(ref_) ? ref_.slice(6) : null;
  const src = id ? r.assetUrl(id) : null;
  if (!src) return null;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} className={className} loading={eager ? "eager" : "lazy"} decoding="async" />;
}

function Hero({ b, r, first }: { b: SiteBlockOf<"hero">; r: SiteRenderContext; first: boolean }) {
  const preview = r.mode === "preview";
  const bold = r.theme.style === "bold";
  const centered = b.layout === "centered";
  const img = b.image ? <Img ref_={b.image} r={r} alt="" eager={first} className="w-full rounded-[var(--site-radius)] object-cover shadow-2xl ring-1 ring-black/5" /> : null;
  const HeadingTag = first ? "h1" : "h2";
  return (
    <section
      id={b.id}
      className={bold ? "bg-[var(--site-brand)] text-[var(--site-brand-fg)]" : r.theme.style === "soft" ? "bg-[radial-gradient(80%_120%_at_10%_0%,color-mix(in_oklch,var(--site-brand)_16%,white),white_70%)]" : "border-b border-slate-200 bg-white"}
    >
      <div className={`mx-auto grid w-full max-w-6xl gap-8 px-4 py-14 @2xl:px-6 @2xl:py-20 ${centered || !img ? "justify-items-center text-center" : "@5xl:grid-cols-[1.15fr_1fr] @5xl:items-center"}`}>
        <div className={`grid gap-4 ${centered || !img ? "max-w-3xl justify-items-center" : ""}`}>
          {b.eyebrow ? <span className={`text-xs font-semibold tracking-[0.16em] uppercase ${bold ? "opacity-80" : "text-[var(--site-brand)]"}`}>{b.eyebrow}</span> : null}
          {b.title ? <HeadingTag className={`${H} text-4xl leading-[1.08] font-bold @2xl:text-5xl @5xl:text-6xl ${bold ? "" : "text-slate-950"}`}>{b.title}</HeadingTag> : null}
          {b.subtitle ? <p className={`max-w-2xl text-lg leading-relaxed ${bold ? "opacity-90" : "text-slate-600"}`}>{b.subtitle}</p> : null}
          {b.ctaLabel || b.secondaryLabel ? (
            <div className="mt-2 flex flex-wrap gap-3">
              <Cta href={b.ctaHref} label={b.ctaLabel} base={r.base} variant={bold ? "inverse" : "primary"} preview={preview} />
              <Cta href={b.secondaryHref} label={b.secondaryLabel} base={r.base} variant="ghost" preview={preview} />
            </div>
          ) : null}
        </div>
        {img && !centered ? <div>{img}</div> : null}
        {img && centered ? <div className="w-full max-w-4xl">{img}</div> : null}
      </div>
    </section>
  );
}

function Features({ b, r }: { b: SiteBlockOf<"features">; r: SiteRenderContext }) {
  return (
    <Wrap id={b.id} className="grid gap-8 py-14 @2xl:py-16">
      {b.title || b.subtitle ? (
        <div className="grid max-w-2xl gap-2">
          {b.title ? <h2 className={`${H} text-3xl font-semibold text-slate-950 @2xl:text-4xl`}>{b.title}</h2> : null}
          {b.subtitle ? <p className="text-lg text-slate-600">{b.subtitle}</p> : null}
        </div>
      ) : null}
      <div className="grid gap-4 @2xl:grid-cols-2 @5xl:grid-cols-3">
        {b.items.map((it, i) => {
          const Icon = ICONS[it.icon] ?? Sparkles;
          return (
            <div key={i} className={`grid content-start gap-3 rounded-[var(--site-radius)] p-6 ${r.theme.style === "minimal" ? "border border-slate-200" : "bg-slate-50 ring-1 ring-slate-200/70"}`}>
              <span aria-hidden className="grid size-10 place-items-center rounded-[calc(var(--site-radius)*0.6)] bg-[color-mix(in_oklch,var(--site-brand)_14%,white)] text-[var(--site-brand)]">
                <Icon className="size-5" />
              </span>
              {it.title ? <h3 className={`${H} text-lg font-semibold text-slate-900`}>{it.title}</h3> : null}
              {it.body ? <p className="text-[15px] leading-relaxed text-slate-600">{inline(it.body, r.base)}</p> : null}
            </div>
          );
        })}
      </div>
    </Wrap>
  );
}

function Testimonials({ b, r }: { b: SiteBlockOf<"testimonials">; r: SiteRenderContext }) {
  // Real customers only: quotes whose account is not (or no longer) a customer are never shown.
  const items = b.items.filter((i) => i.quote.trim() && r.customers[i.accountId]);
  if (!items.length) return null;
  return (
    <Wrap id={b.id} className="grid gap-8 py-14 @2xl:py-16">
      {b.title ? <h2 className={`${H} text-3xl font-semibold text-slate-950 @2xl:text-4xl`}>{b.title}</h2> : null}
      <div className="grid gap-4 @3xl:grid-cols-2 @5xl:grid-cols-3">
        {items.map((it, i) => (
          <figure key={i} className="grid content-between gap-5 rounded-[var(--site-radius)] bg-white p-6 shadow-[0_1px_2px_rgb(0_0_0/0.05),0_12px_32px_-16px_rgb(0_0_0/0.18)] ring-1 ring-slate-200/70">
            <Quote aria-hidden className="size-6 text-[var(--site-brand)]" />
            <blockquote className="text-[15px] leading-relaxed text-slate-700">“{it.quote}”</blockquote>
            <figcaption className="text-sm">
              <span className="font-semibold text-slate-900">{it.author || r.customers[it.accountId]!.name}</span>
              <span className="block text-slate-500">{[it.role, r.customers[it.accountId]!.name].filter(Boolean).join(" · ")}</span>
            </figcaption>
          </figure>
        ))}
      </div>
    </Wrap>
  );
}

function Pricing({ b, r }: { b: SiteBlockOf<"pricing">; r: SiteRenderContext }) {
  const items = b.items.filter((i) => r.products[i.productId]);
  if (!items.length) return null;
  const preview = r.mode === "preview";
  return (
    <Wrap id={b.id} className="grid gap-8 py-14 @2xl:py-16">
      {b.title || b.subtitle ? (
        <div className="grid max-w-2xl gap-2">
          {b.title ? <h2 className={`${H} text-3xl font-semibold text-slate-950 @2xl:text-4xl`}>{b.title}</h2> : null}
          {b.subtitle ? <p className="text-lg text-slate-600">{b.subtitle}</p> : null}
        </div>
      ) : null}
      <div className={`grid gap-4 ${items.length > 1 ? "@3xl:grid-cols-2" : ""} ${items.length > 2 ? "@5xl:grid-cols-3" : ""}`}>
        {items.map((it) => {
          const p = r.products[it.productId]!;
          return (
            <div key={it.productId} className={`grid content-start gap-4 rounded-[var(--site-radius)] p-6 ${it.highlight ? "bg-[var(--site-accent)] text-[var(--site-accent-fg)] shadow-xl" : "bg-white ring-1 ring-slate-200"}`}>
              <h3 className={`${H} text-xl font-semibold`}>{p.name}</h3>
              {p.description ? <p className={`text-sm leading-relaxed ${it.highlight ? "opacity-85" : "text-slate-600"}`}>{p.description.slice(0, 300)}</p> : null}
              {it.price ? (
                <p className="flex items-baseline gap-1.5">
                  <span className={`${H} text-3xl font-bold`}>{it.price}</span>
                  {it.period ? <span className={`text-sm ${it.highlight ? "opacity-80" : "text-slate-500"}`}>{it.period}</span> : null}
                </p>
              ) : null}
              {it.features.length ? (
                <ul className="grid gap-2 text-sm">
                  {it.features.filter(Boolean).map((f, i) => (
                    <li key={i} className="flex gap-2">
                      <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-[var(--site-brand)]" />
                      {f}
                    </li>
                  ))}
                </ul>
              ) : null}
              <Cta href={it.ctaHref} label={it.ctaLabel} base={r.base} variant={it.highlight ? "inverse" : "primary"} preview={preview} />
            </div>
          );
        })}
      </div>
    </Wrap>
  );
}

function ContactBlock({ b, r }: { b: SiteBlockOf<"contactForm">; r: SiteRenderContext }) {
  return (
    <Wrap id={b.id} className="py-14 @2xl:py-16">
      <div className="grid gap-8 rounded-[var(--site-radius)] bg-slate-50 p-6 ring-1 ring-slate-200/70 @2xl:p-10 @5xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <div className="grid content-start gap-3">
          <h2 className={`${H} text-3xl font-semibold text-slate-950`}>{b.title || r.labels.contactUs}</h2>
          {b.body ? <p className="text-slate-600">{b.body}</p> : null}
        </div>
        {r.mode === "live" && r.form ? (
          <SiteContactForm siteSlug={r.form.siteSlug} pageId={r.form.pageId} blockId={b.id} fields={b.fields} submitLabel={b.submitLabel} successMessage={b.successMessage} consentText={b.consentText} labels={r.form.labels} />
        ) : (
          <SiteContactForm preview siteSlug="" pageId="" blockId={b.id} fields={b.fields} submitLabel={b.submitLabel} successMessage={b.successMessage} consentText={b.consentText} labels={r.form?.labels} />
        )}
      </div>
    </Wrap>
  );
}

export function Block({ b, r, first }: { b: SiteBlock; r: SiteRenderContext; first: boolean }) {
  switch (b.type) {
    case "hero":
      return <Hero b={b} r={r} first={first} />;
    case "features":
      return <Features b={b} r={r} />;
    case "richText":
      return (
        <Wrap id={b.id} className="max-w-3xl py-10">
          <RichText body={b.body} base={r.base} />
        </Wrap>
      );
    case "image":
      return (
        <Wrap id={b.id} className={`py-8 ${b.width === "content" ? "max-w-3xl" : ""}`}>
          <figure className="grid gap-2">
            <Img ref_={b.image} r={r} alt={b.alt} className="w-full rounded-[var(--site-radius)] object-cover ring-1 ring-black/5" />
            {b.caption ? <figcaption className="text-sm text-slate-500">{b.caption}</figcaption> : null}
          </figure>
        </Wrap>
      );
    case "cta":
      return (
        <Wrap id={b.id} className="py-12">
          <div className="flex flex-wrap items-center justify-between gap-6 rounded-[var(--site-radius)] bg-[var(--site-accent)] p-8 text-[var(--site-accent-fg)] @2xl:p-10">
            <div className="grid max-w-2xl gap-2">
              {b.title ? <h2 className={`${H} text-2xl font-semibold @2xl:text-3xl`}>{b.title}</h2> : null}
              {b.body ? <p className="opacity-85">{b.body}</p> : null}
            </div>
            <Cta href={b.ctaHref} label={b.ctaLabel} base={r.base} preview={r.mode === "preview"} />
          </div>
        </Wrap>
      );
    case "faq":
      return (
        <Wrap id={b.id} className="grid gap-6 py-14 @5xl:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
          {b.title ? <h2 className={`${H} text-3xl font-semibold text-slate-950`}>{b.title}</h2> : <span />}
          <div className="grid divide-y divide-slate-200 border-y border-slate-200">
            {b.items.map((it, i) => (
              <details key={i} className="group py-2">
                <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-4 text-[15px] font-medium text-slate-900 [&::-webkit-details-marker]:hidden">
                  {it.q}
                  <span aria-hidden className="text-xl text-slate-400 transition-transform group-open:rotate-45">
                    +
                  </span>
                </summary>
                <RichText body={it.a} base={r.base} className="grid gap-3 pb-4 text-[15px] leading-relaxed text-slate-600" />
              </details>
            ))}
          </div>
        </Wrap>
      );
    case "testimonials":
      return <Testimonials b={b} r={r} />;
    case "pricing":
      return <Pricing b={b} r={r} />;
    case "contactForm":
      return <ContactBlock b={b} r={r} />;
    case "logoStrip": {
      const items = b.items.filter((i) => i.image || i.name);
      if (!items.length) return null;
      return (
        <Wrap id={b.id} className="grid gap-6 py-10">
          {b.title ? <p className="text-center text-xs font-semibold tracking-[0.16em] text-slate-500 uppercase">{b.title}</p> : null}
          <ul className="flex flex-wrap items-center justify-center gap-x-10 gap-y-6">
            {items.map((it, i) => (
              <li key={i} className="flex h-10 items-center">
                {it.image ? <Img ref_={it.image} r={r} alt={it.name} className="h-8 w-auto max-w-[9rem] object-contain opacity-70 grayscale transition hover:opacity-100 hover:grayscale-0" /> : <span className="text-sm font-semibold text-slate-500">{it.name}</span>}
              </li>
            ))}
          </ul>
        </Wrap>
      );
    }
  }
}

export function SiteBlocks({ content, r }: { content: PageContent; r: SiteRenderContext }) {
  const startsWithHero = content.blocks[0]?.type === "hero";
  return (
    <main>
      {!startsWithHero && content.title ? (
        <Wrap className="pt-14 pb-2">
          <h1 className={`${H} text-4xl font-bold text-slate-950 @2xl:text-5xl`}>{content.title}</h1>
        </Wrap>
      ) : null}
      {content.blocks.map((b, i) => (
        <Block key={b.id} b={b} r={r} first={i === 0} />
      ))}
    </main>
  );
}

export function SiteHeader({ name, nav, r, logoUrl }: { name: string; nav: SiteNav; r: SiteRenderContext; logoUrl: string | null }) {
  const preview = r.mode === "preview";
  const links = nav.map((n) => ({ label: n.label, href: resolveHref(n.href, r.base) })).filter((n): n is { label: string; href: string } => !!n.href);
  return (
    <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-white/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-4 px-4 @2xl:px-6">
        <a href={preview ? undefined : r.base} className="flex min-w-0 items-center gap-2.5 font-semibold text-slate-950">
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt="" className="h-8 w-auto max-w-[8rem] object-contain" />
          ) : (
            <span aria-hidden className="grid size-8 place-items-center rounded-[calc(var(--site-radius)*0.6)] bg-[var(--site-brand)] text-sm font-bold text-[var(--site-brand-fg)]">
              {name.slice(0, 1).toUpperCase()}
            </span>
          )}
          <span className="truncate font-[family-name:var(--site-heading)]">{name}</span>
        </a>
        {links.length ? (
          <>
            <nav className="hidden items-center gap-1 @3xl:flex" aria-label={name}>
              {links.map((l, i) => (
                <a key={i} href={preview ? undefined : l.href} className="rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-slate-100 hover:text-slate-950">
                  {l.label}
                </a>
              ))}
            </nav>
            <details className="relative @3xl:hidden">
              <summary className="flex min-h-11 cursor-pointer list-none items-center rounded-lg border border-slate-200 px-3 text-sm font-medium text-slate-700 [&::-webkit-details-marker]:hidden">{r.labels.menu}</summary>
              <nav className="absolute end-0 top-12 grid w-56 gap-1 rounded-xl border border-slate-200 bg-white p-2 shadow-xl" aria-label={name}>
                {links.map((l, i) => (
                  <a key={i} href={preview ? undefined : l.href} className="flex min-h-11 items-center rounded-lg px-3 text-sm text-slate-700 hover:bg-slate-100">
                    {l.label}
                  </a>
                ))}
              </nav>
            </details>
          </>
        ) : null}
      </div>
    </header>
  );
}

export function SiteFooterView({ name, footer, r }: { name: string; footer: SiteFooter; r: SiteRenderContext }) {
  const preview = r.mode === "preview";
  const links = footer.links.map((n) => ({ label: n.label, href: resolveHref(n.href, r.base) })).filter((n): n is { label: string; href: string } => !!n.href);
  return (
    <footer className="mt-10 border-t border-slate-200 bg-slate-50">
      <div className="mx-auto grid w-full max-w-6xl gap-4 px-4 py-10 text-sm text-slate-600 @2xl:px-6 @3xl:grid-cols-[1fr_auto] @3xl:items-start">
        <div className="grid gap-2">
          <span className="font-semibold text-slate-900">{name}</span>
          {footer.text ? <p className="max-w-xl whitespace-pre-line">{footer.text}</p> : null}
        </div>
        {links.length ? (
          <nav className="flex flex-wrap gap-x-5 gap-y-2" aria-label={name}>
            {links.map((l, i) => (
              <a key={i} href={preview ? undefined : l.href} className="hover:text-slate-950">
                {l.label}
              </a>
            ))}
          </nav>
        ) : null}
        {footer.showPoweredBy ? <p className="text-xs text-slate-400 @3xl:col-span-2">{r.labels.poweredBy}</p> : null}
      </div>
    </footer>
  );
}
