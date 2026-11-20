"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Timer } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useI18n } from "@/i18n/client";
import { cn } from "@/lib/utils";

const FLOW = ["NEW", "OPEN", "PENDING", "ON_HOLD", "SOLVED"] as const;

/** Ticket flow board: where tickets are right now (new → working → waiting → solved), sized by real counts. */
export function TicketFlow({ flow, hrefs }: { flow: Record<string, number>; hrefs: Record<string, string> }) {
  const { t } = useI18n();
  const reduced = useReducedMotion();
  const max = Math.max(1, ...FLOW.map((s) => flow[s] ?? 0));
  const tone = { NEW: "bg-info", OPEN: "bg-primary", PENDING: "bg-warning", ON_HOLD: "bg-muted-foreground", SOLVED: "bg-success" } as const;
  return (
    <ol className="grid grid-cols-2 gap-2 sm:grid-cols-5" aria-label={t("support.pulse.flowTitle")}>
      {FLOW.map((s, i) => {
        const n = flow[s] ?? 0;
        return (
          <motion.li key={s} initial={reduced ? false : { opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.07 }} className="relative">
            <Link href={hrefs[s] ?? "#"} className="hover-lift grid gap-2 rounded-lg border bg-surface p-3">
              <span className="flex items-center justify-between text-xs text-muted-foreground">
                {t(`support.pulse.flow.${s}`)}
                {i < FLOW.length - 1 ? <span aria-hidden className="hidden text-muted-foreground/60 sm:inline rtl:-scale-x-100">→</span> : null}
              </span>
              <span className="text-2xl font-semibold tabular-nums">{n}</span>
              <span className="h-1.5 overflow-hidden rounded-full bg-muted">
                <motion.span
                  className={cn("block h-full rounded-full", tone[s])}
                  initial={reduced ? false : { width: 0 }}
                  animate={{ width: `${(n / max) * 100}%` }}
                  transition={{ type: "spring", stiffness: 90, damping: 18, delay: 0.1 + i * 0.07 }}
                />
              </span>
            </Link>
          </motion.li>
        );
      })}
    </ol>
  );
}

function useNow(ms = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

function clock(ms: number) {
  const neg = ms < 0;
  const s = Math.floor(Math.abs(ms) / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const core = d ? `${d}d ${h}h ${String(m).padStart(2, "0")}m` : `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return neg ? `-${core}` : core;
}

/** Live SLA countdowns from the tickets' real due times (respond-by / resolve-by), soonest first. */
export function SlaTimers({ items, locale }: { items: { id: string; number: number; subject: string; priority: string; kind: "respond" | "resolve"; dueAt: string }[]; locale: string }) {
  const { t } = useI18n();
  const now = useNow();
  const reduced = useReducedMotion();
  if (!items.length) return <p className="text-sm text-muted-foreground">{t("support.pulse.noTimers")}</p>;
  return (
    <ul className="grid gap-2">
      {items.map((x, i) => {
        const left = new Date(x.dueAt).getTime() - now;
        const state = left < 0 ? "danger" : left < 3_600_000 ? "warning" : "ok";
        const ratio = Math.max(0, Math.min(1, left / (8 * 3_600_000)));
        return (
          <motion.li key={x.id} initial={reduced ? false : { opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.05 }}>
            <Link href={`/${locale}/support/tickets/${x.id}`} className="flex items-center gap-3 rounded-md border bg-surface px-3 py-2 text-sm hover:bg-muted/50">
              <svg viewBox="0 0 36 36" className="size-9 shrink-0 -rotate-90" aria-hidden>
                <circle cx="18" cy="18" r="15" fill="none" strokeWidth="4" className="stroke-muted" />
                <motion.circle
                  cx="18"
                  cy="18"
                  r="15"
                  fill="none"
                  strokeWidth="4"
                  strokeLinecap="round"
                  className={state === "danger" ? "stroke-danger" : state === "warning" ? "stroke-warning" : "stroke-success"}
                  initial={false}
                  animate={{ pathLength: state === "danger" ? 1 : Math.max(0.03, ratio) }}
                  transition={{ duration: 0.6 }}
                />
              </svg>
              <span className="grid min-w-0 flex-1">
                <span className="truncate font-medium">
                  #{x.number} {x.subject}
                </span>
                <span className="text-xs text-muted-foreground">{t(`support.pulse.${x.kind}`)}</span>
              </span>
              <span className={cn("flex items-center gap-1 font-mono text-sm tabular-nums", state === "danger" ? "text-danger" : state === "warning" ? "text-warning" : "text-foreground")} aria-label={t(left < 0 ? "support.pulse.overdueBy" : "support.pulse.leftAria", { time: clock(left).replace("-", "") })}>
                <Timer className="size-3.5" aria-hidden /> {clock(left)}
              </span>
              {x.priority === "URGENT" || x.priority === "HIGH" ? <Badge tone={x.priority === "URGENT" ? "danger" : "warning"}>{t(`support.priorities.${x.priority}`)}</Badge> : null}
            </Link>
          </motion.li>
        );
      })}
    </ul>
  );
}

/** Customer mood over the last 14 days from each new ticket's detected sentiment (stacked bars). */
export function SentimentStrip({ days, locale }: { days: { day: string; positive: number; neutral: number; negative: number }[]; locale: string }) {
  const { t } = useI18n();
  const reduced = useReducedMotion();
  const total = days.reduce((n, d) => n + d.positive + d.neutral + d.negative, 0);
  if (!total) return <p className="text-sm text-muted-foreground">{t("support.pulse.noSentiment")}</p>;
  const max = Math.max(1, ...days.map((d) => d.positive + d.neutral + d.negative));
  const neg = days.reduce((n, d) => n + d.negative, 0);
  const pos = days.reduce((n, d) => n + d.positive, 0);
  const fmt = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" });
  const W = 14 * 22;
  const H = 64;
  return (
    <figure className="grid gap-2">
      <svg viewBox={`0 0 ${W} ${H + 14}`} className="h-24 w-full" role="img" aria-label={t("support.pulse.sentimentAria", { positive: pos, negative: neg, total })}>
        {days.map((d, i) => {
          const sum = d.positive + d.neutral + d.negative;
          const h = (sum / max) * H;
          const segs = [
            { n: d.negative, cls: "fill-danger" },
            { n: d.neutral, cls: "fill-muted-foreground/40" },
            { n: d.positive, cls: "fill-success" },
          ];
          let y = H;
          return (
            <g key={d.day}>
              <title>{`${fmt.format(new Date(d.day))}: +${d.positive} · ${d.neutral} · −${d.negative}`}</title>
              {segs.map((s, k) => {
                const sh = sum ? (s.n / sum) * h : 0;
                y -= sh;
                return sh ? (
                  <motion.rect key={k} x={i * 22 + 3} width={16} rx={2} className={s.cls} initial={reduced ? false : { y: H, height: 0 }} animate={{ y, height: sh }} transition={{ delay: i * 0.03, type: "spring", stiffness: 120, damping: 20 }} />
                ) : null;
              })}
              {i % 3 === 0 ? (
                <text x={i * 22 + 11} y={H + 12} textAnchor="middle" className="fill-muted-foreground text-[8px]">
                  {fmt.format(new Date(d.day))}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
      <figcaption className="flex flex-wrap gap-3 text-xs text-muted-foreground">
        <span className="flex items-center gap-1"><span className="inline-block size-2 rounded-sm bg-success" />{t("support.pulse.positive", { count: pos })}</span>
        <span className="flex items-center gap-1"><span className="inline-block size-2 rounded-sm bg-danger" />{t("support.pulse.negative", { count: neg })}</span>
        <span>{t("support.pulse.sentimentNote")}</span>
      </figcaption>
    </figure>
  );
}
