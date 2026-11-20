import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import type { Translate } from "@/i18n/translate";

export interface CitationItem {
  ref: string;
  documentId: string;
  title: string;
  passage: number;
}

/**
 * Source citations of an AI deliverable: each reference links to the cited passage in Company Brain. Same rendering
 * as the task page; usable from server and client components (pass the matching `t`).
 */
export function CitationList({ citations, locale, t, emptyText }: { citations: CitationItem[]; locale: string; t: Translate; emptyText?: string }) {
  if (!citations.length) return emptyText ? <p className="text-sm text-muted-foreground">{emptyText}</p> : null;
  return (
    <ol className="grid gap-1.5 text-sm">
      {citations.map((c) => (
        <li key={c.ref} className="flex items-center gap-2">
          <Badge className="font-mono">{c.ref}</Badge>
          <Link className="min-w-0 truncate hover:underline" href={`/${locale}/brain/${c.documentId}#passage-${c.passage}`}>
            {c.title} · {t("agentTasks.passage", { n: c.passage })}
          </Link>
        </li>
      ))}
    </ol>
  );
}
