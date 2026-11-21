import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";

/** Page shell for the "no company" and "forbidden" states. */
export function PageState({ header, kind, message }: { header: ReactNode; kind: "empty" | "forbidden"; message: string }) {
  return (
    <div className="mx-auto grid max-w-[1400px] gap-4">
      {header}
      {kind === "empty" ? (
        <Card>
          <p className="p-4 text-muted-foreground">{message}</p>
        </Card>
      ) : (
        <Notice tone="warning">{message}</Notice>
      )}
    </div>
  );
}

export function Pager({ prevHref, nextHref, labels }: { prevHref: string | null; nextHref: string | null; labels: { previous: string; next: string } }) {
  if (!prevHref && !nextHref) return null;
  return (
    <nav className="flex justify-between gap-2 border-t px-4 py-2 text-sm" aria-label={labels.next}>
      {prevHref ? (
        <a className="text-primary hover:underline" href={prevHref}>
          {labels.previous}
        </a>
      ) : (
        <span />
      )}
      {nextHref ? (
        <a className="text-primary hover:underline" href={nextHref}>
          {labels.next}
        </a>
      ) : null}
    </nav>
  );
}

/** Build a query string from params, dropping empty values. */
export function qs(params: Record<string, string | undefined | null>) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
  const s = q.toString();
  return s ? `?${s}` : "";
}
