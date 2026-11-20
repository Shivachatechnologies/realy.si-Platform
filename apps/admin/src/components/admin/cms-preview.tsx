"use client";

import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import type { CmsBlock, CmsVariant } from "@/server/modules/cms/schemas";
import { cn } from "@/lib/utils";

/**
 * Live preview of a CMS variant, mirroring the public renderer in apps/user (components/cms/cms-page.tsx):
 * same block layout and the same tiny inline syntax, rendered as React elements (never raw HTML).
 */

const SAFE = /^(\/(?!\/)[^\s]*|https?:\/\/[^\s]+)$/i;

export function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*\*([^*]+)\*\*|\*([^*]+)\*|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1]) out.push(<strong key={i++}>{m[1]}</strong>);
    else if (m[2]) out.push(<em key={i++}>{m[2]}</em>);
    else if (m[3] && m[4] && SAFE.test(m[4]))
      out.push(
        <a key={i++} href={m[4]} className="text-primary underline underline-offset-2" rel="noreferrer noopener" target={m[4].startsWith("/") ? undefined : "_blank"}>
          {m[3]}
        </a>,
      );
    else out.push(m[0]);
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function RichText({ body, className }: { body: string; className?: string }) {
  const blocks = body.split(/\n{2,}/).filter((b) => b.trim());
  return (
    <div className={cn("grid gap-3 leading-relaxed", className)}>
      {blocks.map((b, i) => {
        const lines = b.split("\n");
        if (lines.every((l) => /^\s*[-*] /.test(l)))
          return (
            <ul key={i} className="list-disc ps-5">
              {lines.map((l, j) => (
                <li key={j}>{inline(l.replace(/^\s*[-*] /, ""))}</li>
              ))}
            </ul>
          );
        if (/^### /.test(b)) return <h4 key={i} className="text-base font-semibold">{inline(b.slice(4))}</h4>;
        if (/^## /.test(b)) return <h3 key={i} className="font-display text-lg font-semibold">{inline(b.slice(3))}</h3>;
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

const img = (ref: string, media: Record<string, string>) => (ref.startsWith("media:") ? (media[ref] ?? null) : ref || null);

function Block({ b, media, pricingLabel }: { b: CmsBlock; media: Record<string, string>; pricingLabel: string }) {
  switch (b.type) {
    case "hero": {
      const src = img(b.image, media);
      return (
        <section className="grid gap-4 rounded-xl bg-[linear-gradient(135deg,#2f78ff,#0b4fe6)] p-6 text-white sm:grid-cols-[1.3fr_1fr] sm:items-center">
          <div className="grid gap-2">
            {b.eyebrow ? <span className="text-[11px] font-semibold tracking-wider uppercase opacity-80">{b.eyebrow}</span> : null}
            <h2 className="font-display text-2xl leading-tight font-bold">{b.title || "…"}</h2>
            {b.subtitle ? <p className="text-sm opacity-90">{b.subtitle}</p> : null}
            {b.ctaLabel ? <span className="mt-1 inline-flex w-fit rounded-md bg-white px-3 py-1.5 text-xs font-semibold text-[#0b4fe6]">{b.ctaLabel}</span> : null}
          </div>
          {src ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={src} alt="" className="max-h-48 w-full rounded-lg object-cover" />
          ) : null}
        </section>
      );
    }
    case "features":
      return (
        <section className="grid gap-3">
          {b.title ? <h3 className="font-display text-lg font-semibold">{b.title}</h3> : null}
          <div className="grid gap-2 sm:grid-cols-3">
            {b.items.map((it, i) => (
              <div key={i} className="rounded-lg border bg-surface p-3">
                <div className="text-sm font-semibold">{it.title}</div>
                <p className="mt-1 text-xs text-muted-foreground">{inline(it.body)}</p>
              </div>
            ))}
          </div>
        </section>
      );
    case "richText":
      return <RichText body={b.body} className="text-sm" />;
    case "image": {
      const src = img(b.image, media);
      return (
        <figure className="grid gap-1">
          {src ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={src} alt={b.alt} className="w-full rounded-lg border object-cover" />
          ) : (
            <div className="grid h-28 place-items-center rounded-lg border border-dashed text-xs text-muted-foreground">{b.alt || "image"}</div>
          )}
          {b.caption ? <figcaption className="text-xs text-muted-foreground">{b.caption}</figcaption> : null}
        </figure>
      );
    }
    case "cta":
      return (
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-accent p-4">
          <div>
            <h3 className="font-display font-semibold">{b.title}</h3>
            {b.body ? <p className="text-xs text-muted-foreground">{b.body}</p> : null}
          </div>
          {b.ctaLabel ? <span className="inline-flex rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground">{b.ctaLabel}</span> : null}
        </section>
      );
    case "faq":
      return (
        <section className="grid gap-2">
          {b.title ? <h3 className="font-display text-lg font-semibold">{b.title}</h3> : null}
          {b.items.map((it, i) => (
            <details key={i} className="group rounded-lg border bg-surface px-3 py-2">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-sm font-medium">
                {it.q}
                <ChevronDown className="size-4 transition-transform group-open:rotate-180" aria-hidden />
              </summary>
              <RichText body={it.a} className="mt-2 text-xs text-muted-foreground" />
            </details>
          ))}
        </section>
      );
    case "pricing":
      return (
        <section className="grid gap-2 rounded-xl border border-dashed p-4 text-center">
          {b.title ? <h3 className="font-display text-lg font-semibold">{b.title}</h3> : null}
          {b.subtitle ? <p className="text-xs text-muted-foreground">{b.subtitle}</p> : null}
          <p className="text-[11px] text-muted-foreground">{pricingLabel}</p>
        </section>
      );
  }
}

export function CmsPreview({ variant, media, locale, pricingLabel, emptyLabel }: { variant: CmsVariant | undefined; media: Record<string, string>; locale: string; pricingLabel: string; emptyLabel: string }) {
  if (!variant || (!variant.title && !variant.blocks.length)) return <p className="p-6 text-center text-xs text-muted-foreground">{emptyLabel}</p>;
  return (
    <article lang={locale} dir={locale.startsWith("ar") ? "rtl" : "ltr"} className="grid gap-5 p-4">
      <header className="grid gap-1">
        <h1 className="font-display text-2xl font-bold tracking-tight">{variant.title}</h1>
        {variant.summary ? <p className="text-sm text-muted-foreground">{variant.summary}</p> : null}
      </header>
      {variant.blocks.map((b) => (
        <Block key={b.id} b={b} media={media} pricingLabel={pricingLabel} />
      ))}
    </article>
  );
}
