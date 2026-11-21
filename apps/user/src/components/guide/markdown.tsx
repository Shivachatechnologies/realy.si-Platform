"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useI18n } from "@/i18n/client";
import { cn } from "@/lib/utils";

/** App paths the AI refers to (e.g. /crm/deals, /approvals) become links into the current locale. */
const APP_ROOTS =
  "crm|finance|hr|projects|marketing|sales|support|product|products|operations|workflows|workforce|intelligence|analytics|objectives|tasks|plans|activity|approvals|company|organization|graph|brain|documents|customers|communication|integrations|marketplace|settings|builder|command";
const INLINE = new RegExp(
  String.raw`(\*\*[^*]+\*\*)|(\x60[^\x60]+\x60)|(\[[^\]]+\]\((?:https?:\/\/|\/)[^)\s]+\))|((?<![\w/])\/(?:${APP_ROOTS})(?:\/[\w-]+)*\/?)`,
  "g",
);

function inline(text: string, locale: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(INLINE)) {
    const at = m.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    const [tok] = m;
    const k = `${key}-${i++}`;
    if (m[1]) out.push(<strong key={k} className="font-semibold text-foreground">{tok.slice(2, -2)}</strong>);
    else if (m[2]) out.push(<code key={k} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">{tok.slice(1, -1)}</code>);
    else if (m[3]) {
      const label = tok.slice(1, tok.indexOf("]("));
      const href = tok.slice(tok.indexOf("](") + 2, -1);
      out.push(
        href.startsWith("/") ? (
          <Link key={k} href={href.startsWith(`/${locale}`) ? href : `/${locale}${href}`} className="font-medium text-primary underline-offset-4 hover:underline">
            {label}
          </Link>
        ) : (
          <a key={k} href={href} target="_blank" rel="noopener noreferrer" className="font-medium text-primary underline-offset-4 hover:underline">
            {label}
          </a>
        ),
      );
    } else {
      const path = tok.replace(/\/$/, "");
      out.push(
        <Link key={k} href={`/${locale}${path}`} className="font-medium text-primary underline-offset-4 hover:underline">
          {path}
        </Link>,
      );
    }
    last = at + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/**
 * Minimal, safe Markdown for AI results: headings, bullet / numbered lists, bold, code, links and app paths as
 * links. No raw HTML is ever rendered.
 */
export function Markdown({ text, className }: { text: string; className?: string }) {
  const { locale } = useI18n();
  const blocks: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let para: string[] = [];
  const flushPara = () => {
    if (para.length) blocks.push(<p key={`p${blocks.length}`}>{inline(para.join(" "), locale, `p${blocks.length}`)}</p>);
    para = [];
  };
  const flushList = () => {
    if (!list) return;
    const Tag = list.ordered ? "ol" : "ul";
    const n = blocks.length;
    blocks.push(
      <Tag key={`l${n}`} className={cn("grid gap-1 ps-5", list.ordered ? "list-decimal" : "list-disc")}>
        {list.items.map((it, j) => (
          <li key={j}>{inline(it, locale, `l${n}-${j}`)}</li>
        ))}
      </Tag>,
    );
    list = null;
  };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trimEnd();
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    const ul = /^\s*[-*•]\s+(.*)$/.exec(line);
    const ol = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (!line.trim()) {
      flushPara();
      flushList();
    } else if (h) {
      flushPara();
      flushList();
      const n = blocks.length;
      blocks.push(
        <p key={`h${n}`} role="heading" aria-level={Math.min(6, h[1]!.length + 2)} className={cn("font-semibold tracking-tight text-foreground", h[1]!.length <= 2 ? "text-base" : "text-sm")}>
          {inline(h[2]!, locale, `h${n}`)}
        </p>,
      );
    } else if (ul || ol) {
      flushPara();
      const ordered = !!ol;
      if (list && list.ordered !== ordered) flushList();
      list ??= { ordered, items: [] };
      list.items.push((ul ?? ol)![1]!);
    } else {
      flushList();
      para.push(line.trim());
    }
  }
  flushPara();
  flushList();
  return <div className={cn("grid gap-2 text-sm leading-relaxed text-foreground/90 [overflow-wrap:anywhere]", className)}>{blocks}</div>;
}
