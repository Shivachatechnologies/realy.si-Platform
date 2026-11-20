"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/form-error";
import { useI18n } from "@/i18n/client";
import { formatDateTime } from "@/i18n/format";
import { api } from "@/lib/api-client";

export interface EmailRow {
  id: string;
  source: "crm" | "proposal" | "marketing" | "inbox";
  direction: "in" | "out";
  subject: string | null;
  snippet: string;
  at: string;
  address: string | null;
  href: string | null;
  meta?: string | null;
  opens?: number;
  clicks?: number;
}

const SOURCE_TONE = { crm: "neutral", proposal: "accent", marketing: "warning", inbox: "success" } as const;

/** Unified email timeline of a record with "load more" (server-rendered first page). */
export function EmailHistoryList({ base, type, id, initial, total, tz }: { base: string; type: string; id: string; initial: EmailRow[]; total: number; tz: string }) {
  const { t, locale } = useI18n();
  const [rows, setRows] = useState(initial);
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  if (!rows.length) return <p className="text-sm text-muted-foreground">{t("crm.emails.empty")}</p>;
  return (
    <div className="grid gap-3">
      <ol className="grid divide-y">
        {rows.map((r) => (
          <li key={r.id} className="grid gap-1 py-2 first:pt-0">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              {r.direction === "in" ? <ArrowDownLeft aria-label={t("crm.emails.inbound")} className="size-3.5" /> : <ArrowUpRight aria-label={t("crm.emails.outbound")} className="size-3.5" />}
              <Badge tone={SOURCE_TONE[r.source]}>{t(`crm.emails.sources.${r.source}`)}</Badge>
              <span>{formatDateTime(r.at, locale, tz)}</span>
              {r.address ? <span className="truncate">{r.address}</span> : null}
              {r.meta ? <span>· {r.meta}</span> : null}
              {r.source === "marketing" && (r.opens || r.clicks) ? <span>· {t("crm.emails.engagement", { opens: r.opens ?? 0, clicks: r.clicks ?? 0 })}</span> : null}
            </div>
            {r.href ? (
              <Link href={`/${locale}${r.href}`} className="text-sm font-medium hover:underline">
                {r.subject || t("crm.emails.noSubject")}
              </Link>
            ) : (
              <span className="text-sm font-medium">{r.subject || t("crm.emails.noSubject")}</span>
            )}
            {r.snippet ? <p className="line-clamp-2 text-xs text-muted-foreground">{r.snippet}</p> : null}
          </li>
        ))}
      </ol>
      {rows.length < total ? (
        <div>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                const next = page + 1;
                const r = await api<{ data: EmailRow[] }>(`${base}/crm/emails?type=${type}&id=${id}&page=${next}`);
                setRows((prev) => [...prev, ...r.data.filter((x) => !prev.some((p) => p.id === x.id))]);
                setPage(next);
              } catch (err) {
                setError(err);
              } finally {
                setBusy(false);
              }
            }}
          >
            {t("crm.emails.loadMore", { shown: rows.length, total })}
          </Button>
        </div>
      ) : null}
      <FormError error={error} />
    </div>
  );
}
