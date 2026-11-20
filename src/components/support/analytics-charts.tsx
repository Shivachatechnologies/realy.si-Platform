import { formatNumber } from "@/i18n/format";
import type { Translate } from "@/i18n/translate";
import { cn } from "@/lib/utils";
import type { supportAnalytics } from "@/server/modules/support/analytics";

type Data = Awaited<ReturnType<typeof supportAnalytics>>;

/** Daily ticket volume: opened (area) vs solved (line), from real tickets. SVG, RTL-mirrored, reduced-motion safe. */
export function VolumeChart({ t, locale, data }: { t: Translate; locale: string; data: Data }) {
  const W = 720;
  const H = 220;
  const pad = { l: 34, r: 12, t: 12, b: 26 };
  const n = data.series.length;
  const max = Math.max(1, ...data.series.flatMap((d) => [d.opened, d.solved]));
  const niceMax = max <= 5 ? max : Math.ceil(max / 5) * 5;
  const x = (i: number) => pad.l + (n <= 1 ? 0 : (i * (W - pad.l - pad.r)) / (n - 1));
  const y = (v: number) => pad.t + (1 - v / niceMax) * (H - pad.t - pad.b);
  const line = (key: "opened" | "solved") => data.series.map((d, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(d[key]).toFixed(1)}`).join(" ");
  const area = `${line("opened")} L${x(n - 1).toFixed(1)},${y(0)} L${x(0).toFixed(1)},${y(0)} Z`;
  const ticks = [0, niceMax / 2, niceMax].map((v) => Math.round(v));
  const fmt = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone: "UTC" });
  const labelEvery = Math.max(1, Math.ceil(n / 6));
  if (!data.totals.opened && !data.totals.solved) return <p className="p-4 text-sm text-muted-foreground">{t("support.analytics.noVolume")}</p>;
  return (
    <figure className="grid gap-2">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={t("support.analytics.volumeLabel", { opened: data.totals.opened, solved: data.totals.solved, days: data.days })}>
        <defs>
          <linearGradient id="sv-opened" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="var(--primary)" stopOpacity={0.35} />
            <stop offset="1" stopColor="var(--primary)" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} stroke="var(--border)" strokeDasharray={v ? "2 4" : undefined} />
            <text x={pad.l - 6} y={y(v) + 3} textAnchor="end" className="fill-muted-foreground text-[10px] tabular-nums">
              {formatNumber(v, locale)}
            </text>
          </g>
        ))}
        <g>
          <path d={area} fill="url(#sv-opened)" />
          <path d={line("opened")} fill="none" stroke="var(--primary)" strokeWidth={2} strokeLinejoin="round" />
          <path d={line("solved")} fill="none" stroke="var(--success)" strokeWidth={2} strokeDasharray="5 3" strokeLinejoin="round" />
          {data.series.map((d, i) => (
            <rect key={d.date} x={x(i) - (W - pad.l - pad.r) / n / 2} y={pad.t} width={(W - pad.l - pad.r) / n} height={H - pad.t - pad.b} fill="transparent">
              <title>{`${fmt.format(new Date(`${d.date}T00:00:00Z`))}: ${t("support.analytics.opened")} ${d.opened} · ${t("support.analytics.solved")} ${d.solved}`}</title>
            </rect>
          ))}
        </g>
        {data.series.map((d, i) =>
          i % labelEvery === 0 ? (
            <text key={d.date} x={x(i)} y={H - 8} textAnchor="middle" className="fill-muted-foreground text-[10px]">
              {fmt.format(new Date(`${d.date}T00:00:00Z`))}
            </text>
          ) : null,
        )}
      </svg>
      <figcaption className="flex flex-wrap gap-4 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5"><span className="inline-block h-0.5 w-5 bg-primary" />{t("support.analytics.opened")} · {formatNumber(data.totals.opened, locale)}</span>
        <span className="inline-flex items-center gap-1.5"><span className="inline-block h-0 w-5 border-t-2 border-dashed border-success" />{t("support.analytics.solved")} · {formatNumber(data.totals.solved, locale)}</span>
      </figcaption>
    </figure>
  );
}

/** CSAT: score ring (share of 4–5 ratings) and the 1–5 distribution. Shows "no ratings" rather than a zero. */
export function CsatPanel({ t, locale, csat }: { t: Translate; locale: string; csat: Data["csat"] }) {
  if (!csat.ratings) return <p className="p-4 text-sm text-muted-foreground">{t("support.analytics.noRatings")}</p>;
  const r = 42;
  const c = 2 * Math.PI * r;
  const pct = csat.score ?? 0;
  const max = Math.max(1, ...csat.distribution.map((d) => d.count));
  return (
    <div className="grid items-center gap-4 p-4 sm:grid-cols-[8rem_minmax(0,1fr)]">
      <figure className="relative mx-auto size-32" role="img" aria-label={t("support.analytics.csatLabel", { score: formatNumber(pct, locale, { maximumFractionDigits: 1 }), ratings: csat.ratings })}>
        <svg viewBox="0 0 100 100" className="size-full -rotate-90">
          <circle cx={50} cy={50} r={r} fill="none" stroke="var(--muted)" strokeWidth={9} />
          <circle cx={50} cy={50} r={r} fill="none" stroke={pct >= 80 ? "var(--success)" : pct >= 60 ? "var(--warning)" : "var(--danger)"} strokeWidth={9} strokeLinecap="round" strokeDasharray={`${(pct / 100) * c} ${c}`} className="motion-safe:transition-[stroke-dasharray] motion-safe:duration-700" />
        </svg>
        <figcaption className="absolute inset-0 grid place-content-center text-center">
          <span className="font-display text-2xl tabular-nums">{formatNumber(pct, locale, { maximumFractionDigits: 0 })}%</span>
          <span className="text-[10px] text-muted-foreground">CSAT</span>
        </figcaption>
      </figure>
      <div className="grid gap-1.5">
        {[...csat.distribution].reverse().map((d) => (
          <div key={d.score} className="grid grid-cols-[2.5rem_minmax(0,1fr)_2rem] items-center gap-2 text-xs">
            <span className="tabular-nums">{"★".repeat(d.score)}</span>
            <span className="h-2 rounded-full bg-muted">
              <span className={cn("block h-2 rounded-full", d.score >= 4 ? "bg-success/70" : d.score === 3 ? "bg-warning/70" : "bg-danger/70")} style={{ width: `${(d.count / max) * 100}%` }} />
            </span>
            <span className="text-end tabular-nums">{d.count}</span>
          </div>
        ))}
        <p className="pt-1 text-xs text-muted-foreground">
          {t("support.analytics.csatMeta", { ratings: csat.ratings, average: formatNumber(csat.average ?? 0, locale, { maximumFractionDigits: 1 }), rate: formatNumber(csat.responseRate ?? 0, locale, { maximumFractionDigits: 1 }) })}
        </p>
      </div>
    </div>
  );
}

/** Median first response and resolution time per priority as paired bars (hours). */
export function SpeedByPriority({ t, locale, rows }: { t: Translate; locale: string; rows: Data["byPriority"] }) {
  const max = Math.max(1, ...rows.flatMap((r) => [r.firstResponse ?? 0, r.resolution ?? 0]));
  const h = (v: number | null) => (v == null ? "—" : t("support.dashboard.hours", { value: formatNumber(v, locale, { maximumFractionDigits: 1 }) }));
  return (
    <div className="grid gap-3 p-4">
      {[...rows].reverse().map((r) => (
        <div key={r.priority} className="grid gap-1">
          <span className="text-xs font-medium">{t(`support.priorities.${r.priority}`)}</span>
          <div className="grid grid-cols-[minmax(0,1fr)_5rem] items-center gap-2 text-xs">
            <span className="h-2 rounded-full bg-muted"><span className="block h-2 rounded-full bg-primary/70" style={{ width: `${((r.firstResponse ?? 0) / max) * 100}%` }} /></span>
            <span className="text-end tabular-nums text-muted-foreground">{h(r.firstResponse)}</span>
            <span className="h-2 rounded-full bg-muted"><span className="block h-2 rounded-full bg-success/60" style={{ width: `${((r.resolution ?? 0) / max) * 100}%` }} /></span>
            <span className="text-end tabular-nums text-muted-foreground">{h(r.resolution)}</span>
          </div>
        </div>
      ))}
      <p className="flex flex-wrap gap-4 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5"><span className="inline-block h-2 w-4 rounded-sm bg-primary/70" />{t("support.analytics.medianFirstResponse")}</span>
        <span className="inline-flex items-center gap-1.5"><span className="inline-block h-2 w-4 rounded-sm bg-success/60" />{t("support.analytics.medianResolution")}</span>
      </p>
    </div>
  );
}
