"use client";

import Link from "next/link";
import { motion, useReducedMotion } from "motion/react";
import { BellRing, Bot, CalendarClock, Flame, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { CountUp } from "@/components/motion/count-up";
import { useI18n } from "@/i18n/client";
import { formatMoney, formatRelativeTime } from "@/i18n/format";
import { cn } from "@/lib/utils";
import { isActive, type TaskStatus } from "./guided-kit";
import { BarsChart, LineChart, ScoreRing, smoothPath } from "./os-charts";

/** Sales OS visual identity: customer-journey map, funnel, pipeline value river, lead intelligence, forecast, AI rail. */

const ease = [0.16, 1, 0.3, 1] as const;

export interface JourneyStage {
  key: string;
  label: string;
  count: number;
  /** Share of the previous stage that reached this one (null for the first). */
  conversion: number | null;
}

/** Lead → contacted → qualified → proposal → won, as a path with nodes sized by volume and travelling "customers". */
export function JourneyMap({ stages, label }: { stages: JourneyStage[]; label: string }) {
  const { t, locale } = useI18n();
  const reduced = useReducedMotion();
  const W = 760;
  const H = 190;
  const max = Math.max(1, ...stages.map((s) => s.count));
  const xs = stages.map((_, i) => 60 + (i * (W - 120)) / Math.max(1, stages.length - 1));
  const ys = stages.map((_, i) => (i % 2 ? 70 : 110));
  const pts = xs.map((x, i) => [x, ys[i]!] as [number, number]);
  const d = smoothPath(pts);
  const pct = (v: number) => new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 0 }).format(v);
  const total = stages[0]?.count ?? 0;
  return (
    <figure className="grid gap-2">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={label}>
        <defs>
          <linearGradient id="sos-journey" x1="0" x2="1">
            <stop offset="0%" style={{ stopColor: "var(--primary)" }} />
            <stop offset="100%" style={{ stopColor: "var(--success)" }} />
          </linearGradient>
        </defs>
        <path d={d} fill="none" stroke="var(--border)" strokeWidth={10} strokeLinecap="round" />
        <motion.path id="sos-journey-path" d={d} fill="none" stroke="url(#sos-journey)" strokeWidth={4} strokeLinecap="round" initial={reduced ? false : { pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.6, ease }} />
        {!reduced && total > 0
          ? [0, 1, 2].map((i) => (
              <circle key={i} r={3.5} fill="var(--primary)" opacity={0.85}>
                <animateMotion dur="6s" begin={`${i * 2}s`} repeatCount="indefinite" path={d} />
              </circle>
            ))
          : null}
        {stages.map((s, i) => {
          const r = 14 + Math.sqrt(s.count / max) * 18;
          const last = i === stages.length - 1;
          return (
            <motion.g key={s.key} initial={reduced ? false : { opacity: 0, scale: 0.4 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.25 + i * 0.22, type: "spring", stiffness: 180, damping: 16 }} style={{ originX: `${xs[i]}px`, originY: `${ys[i]}px` }}>
              <circle cx={xs[i]} cy={ys[i]} r={r + 6} fill={last ? "var(--success)" : "var(--primary)"} opacity={0.12} />
              <circle cx={xs[i]} cy={ys[i]} r={r} fill="var(--surface)" stroke={last ? "var(--success)" : "var(--primary)"} strokeWidth={2.5} />
              <text x={xs[i]} y={ys[i]! + 5} textAnchor="middle" className="fill-foreground text-[15px] font-semibold tabular-nums">
                {s.count}
              </text>
              <text x={xs[i]} y={ys[i]! + (i % 2 ? -r - 12 : r + 22)} textAnchor="middle" className="fill-muted-foreground text-[12px] font-medium">
                {s.label}
              </text>
            </motion.g>
          );
        })}
        {stages.slice(1).map((s, i) =>
          s.conversion !== null ? (
            <motion.text
              key={`c-${s.key}`}
              x={(xs[i]! + xs[i + 1]!) / 2}
              y={(ys[i]! + ys[i + 1]!) / 2 + (i % 2 ? 26 : -18)}
              textAnchor="middle"
              className="fill-primary text-[11px] font-semibold tabular-nums"
              initial={reduced ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 1 + i * 0.15 }}
            >
              {t("sales.os.convert", { pct: pct(s.conversion) })}
            </motion.text>
          ) : null,
        )}
      </svg>
      <table className="sr-only">
        <caption>{label}</caption>
        <tbody>
          {stages.map((s) => (
            <tr key={s.key}>
              <th scope="row">{s.label}</th>
              <td>{s.count}</td>
              <td>{s.conversion === null ? "—" : pct(s.conversion)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

/** Funnel bars narrowing by stage, with the overall conversion. */
export function Funnel({ stages, label }: { stages: JourneyStage[]; label: string }) {
  const { locale } = useI18n();
  const reduced = useReducedMotion();
  const max = Math.max(1, ...stages.map((s) => s.count));
  const pct = (v: number) => new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 0 }).format(v);
  return (
    <ol className="grid gap-1.5" aria-label={label}>
      {stages.map((s, i) => (
        <li key={s.key} className="grid grid-cols-[6.5rem_minmax(0,1fr)_3rem] items-center gap-2 text-xs">
          <span className="truncate text-muted-foreground">{s.label}</span>
          <div className="flex justify-center">
            <motion.div
              className="h-6 rounded-md bg-brand-gradient"
              style={{ width: `${Math.max(4, (s.count / max) * 100)}%`, opacity: 1 - i * 0.12 }}
              initial={reduced ? false : { scaleX: 0 }}
              animate={{ scaleX: 1 }}
              transition={{ duration: 0.8, delay: i * 0.1, ease }}
            />
          </div>
          <span className="text-end font-medium tabular-nums">
            {s.count}
            {s.conversion !== null ? <span className="block text-[10px] font-normal text-muted-foreground">{pct(s.conversion)}</span> : null}
          </span>
        </li>
      ))}
    </ol>
  );
}

/** The open pipeline as a river: its width at each stage is the money sitting there. */
export function PipelineRiver({ stages, currency, label, href }: { stages: { id: string; name: string; valueMinor: string; count: number }[]; currency: string; label: string; href: string }) {
  const { t, locale } = useI18n();
  const reduced = useReducedMotion();
  const W = 760;
  const H = 150;
  const mid = 64;
  const vals = stages.map((s) => Number(s.valueMinor));
  const max = Math.max(1, ...vals);
  const n = Math.max(1, stages.length);
  const xs = stages.map((_, i) => 30 + (i * (W - 60)) / Math.max(1, n - 1));
  const half = vals.map((v) => 4 + (v / max) * 46);
  const top = smoothPath(xs.map((x, i) => [x, mid - half[i]!]));
  const bottom = xs
    .map((x, i) => [x, mid + half[i]!] as [number, number])
    .reverse();
  const area = `${top} L${smoothPath(bottom).slice(1)} Z`;
  return (
    <figure className="grid gap-2">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={label}>
        <defs>
          <linearGradient id="sos-river" x1="0" x2="1">
            <stop offset="0%" style={{ stopColor: "var(--info)", stopOpacity: 0.55 }} />
            <stop offset="100%" style={{ stopColor: "var(--primary)", stopOpacity: 0.75 }} />
          </linearGradient>
        </defs>
        {stages.length > 1 ? (
          <motion.path d={area} fill="url(#sos-river)" style={{ originY: `${mid}px` }} initial={reduced ? false : { scaleY: 0, opacity: 0 }} animate={{ scaleY: 1, opacity: 1 }} transition={{ duration: 1.1, ease }} />
        ) : null}
        {!reduced && stages.length > 1 ? (
          <motion.path d={smoothPath(xs.map((x) => [x, mid]))} fill="none" stroke="var(--surface)" strokeOpacity={0.7} strokeWidth={1.5} strokeDasharray="6 10" animate={{ strokeDashoffset: [0, -64] }} transition={{ duration: 3, repeat: Infinity, ease: "linear" }} />
        ) : null}
        {stages.map((s, i) => (
          <g key={s.id}>
            <line x1={xs[i]} x2={xs[i]} y1={mid - half[i]! - 4} y2={mid + half[i]! + 4} stroke="var(--border-strong)" strokeDasharray="2 3" />
            <text x={xs[i]} y={H - 24} textAnchor="middle" className="fill-foreground text-[11px] font-medium">
              {s.name.length > 16 ? `${s.name.slice(0, 15)}…` : s.name}
            </text>
            <text x={xs[i]} y={H - 8} textAnchor="middle" className="fill-muted-foreground text-[10px] tabular-nums">
              {formatMoney({ amountMinor: s.valueMinor, currency }, locale, { display: "narrowSymbol" })} · {s.count}
            </text>
          </g>
        ))}
      </svg>
      <Link href={href} className="justify-self-end text-xs text-muted-foreground hover:underline">
        {t("sales.os.openPipeline")}
      </Link>
      <table className="sr-only">
        <caption>{label}</caption>
        <tbody>
          {stages.map((s) => (
            <tr key={s.id}>
              <th scope="row">{s.name}</th>
              <td>{formatMoney({ amountMinor: s.valueMinor, currency }, locale)}</td>
              <td>{s.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

export interface LeadCard {
  id: string;
  name: string;
  account: string | null;
  score: number;
  label: "HOT" | "WARM" | "NURTURE";
  stage: string;
  lastContactedAt: string | null;
  next: { note: string; dueAt: string } | null;
  valueMinor: string | null;
  currency: string;
}

const TEMP_TONE = { HOT: "danger", WARM: "warning", NURTURE: "info" } as const;

export function LeadIntelCards({ leads }: { leads: LeadCard[] }) {
  const { t, locale } = useI18n();
  const reduced = useReducedMotion();
  return (
    <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {leads.map((l, i) => (
        <motion.li key={l.id} initial={reduced ? false : { opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06, duration: 0.5, ease }}>
          <Link href={`/${locale}/crm/${l.id}`} className="hover-lift grid h-full gap-2 rounded-lg border bg-surface p-3 text-sm shadow-elev-1">
            <div className="flex items-start gap-3">
              <ScoreRing score={l.score} tone={TEMP_TONE[l.label]} label={t("sales.os.scoreAria", { score: l.score })} />
              <div className="min-w-0">
                <p className="truncate font-medium">{l.name}</p>
                <p className="truncate text-xs text-muted-foreground">{l.account ?? t(`crm.stages.${l.stage}`)}</p>
                <div className="mt-1 flex flex-wrap gap-1">
                  <Badge tone={TEMP_TONE[l.label]} pulse={l.label === "HOT"}>
                    {l.label === "HOT" ? <Flame aria-hidden className="size-3" /> : null}
                    {t(`crm.scoreLabels.${l.label}`)}
                  </Badge>
                  <Badge>{t(`crm.stages.${l.stage}`)}</Badge>
                  {l.valueMinor ? <Badge tone="accent">{formatMoney({ amountMinor: l.valueMinor, currency: l.currency }, locale)}</Badge> : null}
                </div>
              </div>
            </div>
            <dl className="grid gap-1 text-xs">
              <div className="flex gap-1">
                <dt className="text-muted-foreground">{t("sales.os.lastTouch")}</dt>
                <dd>{l.lastContactedAt ? formatRelativeTime(l.lastContactedAt, locale) : t("sales.os.never")}</dd>
              </div>
              <div className="flex gap-1">
                <dt className="shrink-0 text-muted-foreground">{t("sales.os.nextAction")}</dt>
                <dd className={cn("truncate", l.next && new Date(l.next.dueAt) < new Date() && "text-danger")}>{l.next ? `${l.next.note} · ${formatRelativeTime(l.next.dueAt, locale)}` : t("sales.os.noNext")}</dd>
              </div>
            </dl>
          </Link>
        </motion.li>
      ))}
    </ul>
  );
}

/** Revenue forecast: won + weighted pipeline per month, best case as a dashed line. */
export function ForecastChart({ months, currency, label }: { months: { month: string; wonMinor: string; weightedMinor: string; bestCaseMinor: string }[]; currency: string; label: string }) {
  const { t, locale } = useI18n();
  const labels = months.map((m) => new Intl.DateTimeFormat(locale, { month: "short", timeZone: "UTC" }).format(new Date(`${m.month}-01T00:00:00Z`)));
  const fmt = (v: number) => formatMoney({ amountMinor: BigInt(Math.round(v)), currency }, locale);
  const won = months.map((m) => Number(m.wonMinor));
  const weighted = months.map((m) => Number(m.wonMinor) + Number(m.weightedMinor));
  const best = months.map((m) => Number(m.wonMinor) + Number(m.bestCaseMinor));
  return (
    <LineChart
      label={label}
      labels={labels}
      format={fmt}
      series={[
        { name: t("sales.os.forecastWon"), values: won, color: "var(--success)", area: true },
        { name: t("sales.os.forecastWeighted"), values: weighted, color: "var(--primary)", area: true },
        { name: t("sales.os.forecastBest"), values: best, color: "var(--info)", dashed: true },
      ]}
    />
  );
}

export { BarsChart };

export interface RailItem {
  id: string;
  kind: "followup" | "ai";
  title: string;
  detail?: string | null;
  at: string;
  href: string;
  overdue?: boolean;
  status?: TaskStatus;
}

/** Next actions: follow-ups due (from the CRM) and AI recommendations (real agent task output). */
export function NextActionsRail({ items, emptyText }: { items: RailItem[]; emptyText: string }) {
  const { t, locale } = useI18n();
  const reduced = useReducedMotion();
  if (!items.length) return <p className="text-sm text-muted-foreground">{emptyText}</p>;
  return (
    <ol className="relative grid gap-3 ps-5 before:absolute before:inset-y-1 before:start-1.5 before:w-px before:bg-border">
      {items.map((it, i) => (
        <motion.li key={`${it.kind}-${it.id}`} className="relative" initial={reduced ? false : { opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.05, ease }}>
          <span aria-hidden className={cn("absolute -start-5 top-1 grid size-3.5 place-items-center rounded-full ring-4 ring-surface", it.kind === "ai" ? "bg-brand-gradient" : it.overdue ? "bg-danger" : "bg-warning")} />
          <Link href={it.href} className="grid gap-0.5 rounded-md p-1 text-sm hover:bg-muted/60">
            <span className="flex items-center gap-1.5 font-medium">
              {it.kind === "ai" ? <Bot aria-hidden className="size-3.5 text-primary" /> : it.overdue ? <BellRing aria-hidden className="size-3.5 text-danger" /> : <CalendarClock aria-hidden className="size-3.5 text-warning" />}
              <span className="truncate">{it.title}</span>
              {it.status && isActive(it.status) ? (
                <Badge tone="accent" pulse>
                  {t(`agentTasks.status.${it.status}`)}
                </Badge>
              ) : null}
            </span>
            {it.detail ? <span className="line-clamp-2 text-xs text-muted-foreground">{it.detail}</span> : null}
            <span className={cn("text-[11px]", it.overdue ? "text-danger" : "text-muted-foreground")}>{formatRelativeTime(it.at, locale)}</span>
          </Link>
        </motion.li>
      ))}
    </ol>
  );
}

/** Big headline number with label for the Sales OS hero. */
export function HeroNumber({ label, value, money, hint }: { label: string; value?: number; money?: { amountMinor: string; currency: string }; hint?: string }) {
  return (
    <div className="grid gap-0.5">
      <span className="flex items-center gap-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
        <Sparkles aria-hidden className="size-3 text-primary" />
        {label}
      </span>
      <span className="text-2xl font-semibold tracking-tight tabular-nums">{money ? <CountUp money={money} /> : <CountUp value={value ?? 0} format="integer" />}</span>
      {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
    </div>
  );
}
