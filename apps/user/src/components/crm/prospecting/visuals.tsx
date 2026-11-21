import Link from "next/link";
import type { ReactNode } from "react";
import { CheckCircle2, CircleAlert, CircleDashed, Mail, Radar, Sparkles, UserSearch } from "lucide-react";
import { cn } from "@/lib/utils";

/** Presentational pieces of /crm/prospecting (no data access): the funnel graphic and the provider checklist. */

type T = (k: string, v?: Record<string, string | number>) => string;

export interface FunnelCounts {
  found: number;
  verified: number;
  contacted: number;
  replied: number;
  meetings: number;
}

const STAGES = ["found", "verified", "contacted", "replied", "meetings"] as const;

/**
 * Honest funnel: each band's width is proportional to its real count (relative to "found"); the step rate under each
 * band is the share of the previous stage. Zero is drawn as an empty outline, never as a sliver.
 */
export function ProspectingFunnel({ counts, t, caption }: { counts: FunnelCounts; t: T; caption?: ReactNode }) {
  const max = Math.max(1, counts.found);
  const colors = ["var(--primary)", "color-mix(in oklch, var(--primary) 82%, var(--success))", "color-mix(in oklch, var(--primary) 60%, var(--success))", "color-mix(in oklch, var(--primary) 35%, var(--success))", "var(--success)"];
  return (
    <figure className="grid gap-3" aria-label={STAGES.map((s) => `${t(`crm.prospecting.funnel.${s}`)}: ${counts[s]}`).join(", ")}>
      <ol className="grid gap-2">
        {STAGES.map((s, i) => {
          const v = counts[s];
          const prev = i ? counts[STAGES[i - 1]!] : null;
          const pct = Math.round((v / max) * 100);
          return (
            <li key={s} className="grid grid-cols-[minmax(84px,120px)_1fr_auto] items-center gap-3 text-sm">
              <span className="text-muted-foreground">{t(`crm.prospecting.funnel.${s}`)}</span>
              <span className="relative h-7 overflow-hidden rounded-md border bg-surface-2/60">
                {v > 0 ? (
                  <span
                    className="absolute inset-y-0 start-0 rounded-md motion-safe:transition-[width] motion-safe:duration-700"
                    style={{ width: `${Math.max(pct, 3)}%`, background: colors[i] }}
                    aria-hidden
                  />
                ) : null}
                {prev !== null && prev > 0 ? <span className="absolute inset-y-0 end-2 grid place-items-center text-[11px] text-muted-foreground tabular-nums">{t("crm.prospecting.funnel.rate", { pct: Math.round((v / prev) * 100) })}</span> : null}
              </span>
              <span className="min-w-10 text-end font-display text-xl tabular-nums">{v}</span>
            </li>
          );
        })}
      </ol>
      {caption ? <figcaption className="text-xs text-muted-foreground">{caption}</figcaption> : null}
    </figure>
  );
}

export interface ProviderRow {
  provider: string;
  name: string;
  connected: boolean;
  status: string;
  account: string | null;
  lastError: string | null;
  calls30d: number;
  failed30d: number;
  cost: string | null;
}

/** Contact-data providers (Apollo, Hunter, PDL) + the other pieces the autopilot needs, each with a connect link. */
export function ProviderStatus({ rows, extras, locale, t }: { rows: ProviderRow[]; extras: { research: string[]; aiText: string[]; email: string | null }; locale: string; t: T }) {
  const pieces = [
    { key: "research", icon: Radar, ok: extras.research.length > 0, detail: extras.research.join(", ") },
    { key: "ai", icon: Sparkles, ok: extras.aiText.length > 0, detail: extras.aiText.join(", ") },
    { key: "email", icon: Mail, ok: !!extras.email, detail: extras.email ?? "" },
  ];
  return (
    <section className="grid content-start gap-3 rounded-xl border bg-surface p-4 shadow-elev-1" aria-labelledby="prov-h">
      <h2 id="prov-h" className="flex items-center gap-2 font-display text-lg">
        <UserSearch className="size-4 text-primary" aria-hidden />
        {t("crm.prospecting.providers.title")}
      </h2>
      <p className="text-xs text-muted-foreground">{t("crm.prospecting.providers.help")}</p>
      <ul className="grid gap-2">
        {rows.map((r) => (
          <li key={r.provider} className={cn("grid gap-1 rounded-lg border p-3 text-sm", r.status === "ERROR" ? "border-danger/40" : r.connected ? "border-success/30" : "border-dashed")}>
            <div className="flex items-center gap-2">
              {r.status === "ERROR" ? <CircleAlert className="size-4 text-danger" aria-hidden /> : r.connected ? <CheckCircle2 className="size-4 text-success" aria-hidden /> : <CircleDashed className="size-4 text-muted-foreground" aria-hidden />}
              <span className="font-medium">{r.name}</span>
              <Link href={`/${locale}/integrations/${r.provider}`} className="ms-auto text-xs font-medium text-primary underline">
                {r.connected ? t("crm.prospecting.providers.manage") : t("crm.prospecting.providers.connect")}
              </Link>
            </div>
            <p className="text-xs text-muted-foreground">
              {r.status === "ERROR"
                ? t("crm.prospecting.providers.failing", { error: r.lastError ?? "—" })
                : r.connected
                  ? t("crm.prospecting.providers.usage", { calls: r.calls30d, failed: r.failed30d, cost: r.cost ?? "—" })
                  : t(`crm.prospecting.providers.what.${r.provider}`)}
            </p>
          </li>
        ))}
      </ul>
      <ul className="grid gap-1.5 border-t pt-3">
        {pieces.map((p) => (
          <li key={p.key} className="flex items-start gap-2 text-sm">
            {p.ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden /> : <CircleDashed className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />}
            <span className="grid gap-0.5">
              <span className="font-medium">
                <p.icon className="me-1 inline size-3.5 align-[-2px]" aria-hidden />
                {t(`crm.prospecting.providers.${p.key}`)}
              </span>
              <span className="text-xs text-muted-foreground">{p.ok ? p.detail : t(`crm.prospecting.providers.missing.${p.key}`)}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
