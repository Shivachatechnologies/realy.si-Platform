import { Badge } from "@/components/ui/badge";
import type { Translate } from "@/i18n/translate";

type Tone = "neutral" | "accent" | "success" | "warning" | "danger" | "info" | "brand";
const STATUS_TONE: Record<string, Tone> = { AI_ACTIVE: "brand", WAITING_HUMAN: "warning", HUMAN_ACTIVE: "info", CLOSED: "neutral" };

export function StatusBadge({ status, t }: { status: string; t: Translate }) {
  return (
    <Badge tone={STATUS_TONE[status] ?? "neutral"} shape="pill" pulse={status === "WAITING_HUMAN"}>
      {t(`livechat.status.${status}`)}
    </Badge>
  );
}

export function OutcomeBadges({ outcomes, t }: { outcomes: string[]; t: Translate }) {
  if (!outcomes.length) return null;
  return (
    <span className="flex flex-wrap gap-1">
      {outcomes.map((o) => (
        <Badge key={o} tone={o === "lead" || o === "resolved" ? "success" : o === "knowledge_gap" || o === "spam" ? "danger" : "neutral"}>
          {t(`livechat.outcomes.${o}`)}
        </Badge>
      ))}
    </span>
  );
}

/**
 * Daily conversations as bars, with the AI-resolved share filled. Plain SVG (server-rendered), labelled for screen
 * readers; each bar has a <title> with the exact numbers.
 */
export function TrendBars({ series, label, resolvedLabel, locale }: { series: { day: string; conversations: number; aiResolved: number }[]; label: string; resolvedLabel: string; locale: string }) {
  const max = Math.max(1, ...series.map((s) => s.conversations));
  const w = 100 / Math.max(series.length, 1);
  const fmt = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone: "UTC" });
  return (
    <figure className="grid gap-2">
      <svg viewBox="0 0 100 40" preserveAspectRatio="none" className="h-36 w-full" role="img" aria-label={label}>
        {series.map((s, i) => {
          const h = (s.conversations / max) * 38;
          const r = (s.aiResolved / max) * 38;
          return (
            <g key={s.day}>
              <title>{`${fmt.format(new Date(`${s.day}T00:00:00Z`))}: ${s.conversations} · ${resolvedLabel} ${s.aiResolved}`}</title>
              <rect x={i * w + w * 0.15} y={40 - h} width={w * 0.7} height={h} rx={0.6} className="fill-muted" />
              <rect x={i * w + w * 0.15} y={40 - r} width={w * 0.7} height={r} rx={0.6} className="fill-primary" />
            </g>
          );
        })}
      </svg>
      <figcaption className="flex items-center gap-3 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1"><span className="size-2.5 rounded-sm bg-muted" aria-hidden />{label}</span>
        <span className="inline-flex items-center gap-1"><span className="size-2.5 rounded-sm bg-primary" aria-hidden />{resolvedLabel}</span>
      </figcaption>
    </figure>
  );
}
