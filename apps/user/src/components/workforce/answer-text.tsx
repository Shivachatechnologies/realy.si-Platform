import { Fragment, type ReactNode } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";

/** In-app paths the AI may link (first path segment). Anything else stays plain text. */
const APP_ROOTS = new Set([
  "intelligence", "analytics", "objectives", "tasks", "workforce", "plans", "activity", "approvals", "company", "organization", "graph", "brain", "documents", "products", "customers",
  "marketing", "sales", "crm", "support", "projects", "product", "operations", "finance", "hr", "communication", "workflows", "integrations", "marketplace", "settings",
]);
const isAppPath = (p: string) => /^\/[a-z0-9][\w\-/?=&.%]*$/i.test(p) && !p.startsWith("//") && APP_ROOTS.has(p.slice(1).split(/[/?#]/)[0]!.toLowerCase());

/** Inline: **bold**, `code`, [label](/path) and bare /paths → in-app links (never raw HTML, never external links). */
function inline(text: string, locale: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]{1,200}\]\(\/[^)\s]{1,300}\)|(?<![\w/])\/[a-z][\w\-/]*[\w])/gi;
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(re)) {
    const tok = m[0];
    if (m.index! > last) out.push(text.slice(last, m.index));
    if (tok.startsWith("**")) out.push(<strong key={i++}>{tok.slice(2, -2)}</strong>);
    else if (tok.startsWith("`")) {
      const inner = tok.slice(1, -1);
      out.push(isAppPath(inner) ? <Link key={i++} className="text-primary hover:underline" href={`/${locale}${inner}`}>{inner}</Link> : <code key={i++} className="rounded bg-muted px-1 font-mono text-[12px]">{inner}</code>);
    } else if (tok.startsWith("[")) {
      const label = tok.slice(1, tok.indexOf("]("));
      const path = tok.slice(tok.indexOf("](") + 2, -1);
      out.push(isAppPath(path) ? <Link key={i++} className="text-primary hover:underline" href={`/${locale}${path}`}>{label}</Link> : label);
    } else out.push(isAppPath(tok) ? <Link key={i++} className="text-primary hover:underline" href={`/${locale}${tok}`}>{tok}</Link> : tok);
    last = m.index! + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** AI answer text: "#" headings, "-" / "1." lists, paragraphs and in-app links. */
export function AnswerText({ text, locale, className }: { text: string; locale: string; className?: string }) {
  const blocks: ReactNode[] = [];
  let list = null as { ordered: boolean; items: string[] } | null;
  let para: string[] = [];
  const flushPara = () => {
    if (para.length) blocks.push(<p className="whitespace-pre-wrap break-words">{inline(para.join("\n"), locale)}</p>);
    para = [];
  };
  const flushList = () => {
    if (list) {
      const Tag = list.ordered ? "ol" : "ul";
      blocks.push(
        <Tag className={cn("grid gap-0.5 ps-5", list.ordered ? "list-decimal" : "list-disc")}>
          {list.items.map((it, j) => (
            <li key={j}>{inline(it, locale)}</li>
          ))}
        </Tag>,
      );
    }
    list = null;
  };
  for (const line of text.replace(/\r\n/g, "\n").split("\n")) {
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    const item = line.match(/^\s*(?:([-*•])|(\d+)[.)])\s+(.*)$/);
    if (h) {
      flushPara();
      flushList();
      blocks.push(<p className={cn("font-semibold", h[1]!.length <= 2 ? "text-base" : "text-sm")}>{inline(h[2]!, locale)}</p>);
    } else if (item) {
      flushPara();
      const ordered = !item[1];
      if (list && list.ordered !== ordered) flushList();
      list ??= { ordered, items: [] };
      list.items.push(item[3]!);
    } else if (!line.trim()) {
      flushPara();
      flushList();
    } else {
      flushList();
      para.push(line);
    }
  }
  flushPara();
  flushList();
  return <div className={cn("grid gap-2 text-sm leading-relaxed", className)}>{blocks.map((b, i) => <Fragment key={i}>{b}</Fragment>)}</div>;
}
