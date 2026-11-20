"use client";

import { motion, useReducedMotion } from "motion/react";
import { useT } from "@/i18n/client";

/** Product Studio visualizations (real data only; animations respect reduced motion). */

const STATUS_FILL: Record<string, string> = {
  PROPOSED: "var(--muted-foreground)",
  PLANNED: "var(--info, var(--primary))",
  IN_PROGRESS: "var(--primary)",
  SHIPPED: "var(--success)",
};
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function useAnim() {
  const reduce = useReducedMotion();
  return (delay = 0) => (reduce ? { initial: false as const } : { initial: { opacity: 0, scale: 0.6 }, animate: { opacity: 1, scale: 1 }, transition: { delay, duration: 0.5, ease: [0.16, 1, 0.3, 1] as const } });
}

interface GraphProps {
  name: string;
  components: string[];
  initiatives: { id: string; title: string }[];
  features: { id: string; title: string; status: string; initiativeId: string | null }[];
}

/**
 * Product map: the architecture's components when the architecture document lists them, otherwise the product's
 * initiatives and features (ring by ring around the product).
 */
export function ProductGraph({ name, components, initiatives, features }: GraphProps) {
  const t = useT();
  const reduce = useReducedMotion();
  const anim = useAnim();
  const W = 640;
  const H = 420;
  const cx = W / 2;
  const cy = H / 2;
  const useArch = components.length >= 2;
  const known = new Set(initiatives.map((i) => i.id));
  const ring1 = useArch ? components.map((c, i) => ({ id: `c${i}`, label: c })) : initiatives.map((i) => ({ id: i.id, label: i.title }));
  const pos1 = new Map(ring1.map((n, i) => {
    const a = (i / Math.max(1, ring1.length)) * Math.PI * 2 - Math.PI / 2;
    return [n.id, { x: cx + Math.cos(a) * 120, y: cy + Math.sin(a) * 100 }];
  }));
  const ring2 = useArch ? [] : features;
  const pos2 = ring2.map((f, i) => {
    const a = (i / Math.max(1, ring2.length)) * Math.PI * 2 - Math.PI / 2 + 0.2;
    return { f, x: cx + Math.cos(a) * 270, y: cy + Math.sin(a) * 180, parent: f.initiativeId && known.has(f.initiativeId) ? pos1.get(f.initiativeId)! : { x: cx, y: cy } };
  });
  const summary = useArch ? components.join(", ") : `${initiatives.length} / ${features.length}`;
  if (!ring1.length && !ring2.length) return <p className="p-4 text-sm text-muted-foreground">{t("product.visuals.graphEmpty")}</p>;
  return (
    <figure role="img" aria-label={t(useArch ? "product.visuals.archLabel" : "product.visuals.mapLabel", { summary })} className="grid gap-2">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" aria-hidden>
        {[...pos1.values()].map((p, i) => (
          <motion.line key={`e1${i}`} x1={cx} y1={cy} x2={p.x} y2={p.y} stroke="var(--border)" strokeWidth={1.5} initial={reduce ? false : { pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.8, delay: 0.1 + i * 0.05 }} />
        ))}
        {pos2.map(({ f, x, y, parent }, i) => (
          <motion.line key={`e2${f.id}`} x1={parent.x} y1={parent.y} x2={x} y2={y} stroke="var(--border)" strokeDasharray="3 3" initial={reduce ? false : { pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.8, delay: 0.4 + i * 0.03 }} />
        ))}
        <motion.g {...anim(0)} style={{ transformOrigin: `${cx}px ${cy}px` }}>
          <circle cx={cx} cy={cy} r={34} fill="var(--primary)" opacity={0.15} />
          <circle cx={cx} cy={cy} r={24} fill="var(--primary)" />
          <text x={cx} y={cy + 50} textAnchor="middle" fontSize={13} fontWeight={600} fill="var(--foreground)">
            {clip(name, 28)}
          </text>
        </motion.g>
        {ring1.map((n, i) => {
          const p = pos1.get(n.id)!;
          return (
            <motion.g key={n.id} {...anim(0.2 + i * 0.05)} style={{ transformOrigin: `${p.x}px ${p.y}px` }}>
              <rect x={p.x - 54} y={p.y - 13} width={108} height={26} rx={7} fill="var(--surface)" stroke={useArch ? "var(--primary)" : "var(--info, var(--primary))"} />
              <text x={p.x} y={p.y + 4} textAnchor="middle" fontSize={10.5} fill="var(--foreground)">
                {clip(n.label, 18)}
              </text>
            </motion.g>
          );
        })}
        {pos2.map(({ f, x, y }, i) => (
          <motion.g key={f.id} {...anim(0.5 + i * 0.03)} style={{ transformOrigin: `${x}px ${y}px` }}>
            <circle cx={x} cy={y} r={6} fill={STATUS_FILL[f.status] ?? "var(--muted-foreground)"} />
            <text x={x} y={y + 17} textAnchor="middle" fontSize={9.5} fill="var(--muted-foreground)">
              {clip(f.title, 16)}
            </text>
          </motion.g>
        ))}
      </svg>
      <figcaption className="text-xs text-muted-foreground">{t(useArch ? "product.visuals.archCaption" : "product.visuals.mapCaption")}</figcaption>
    </figure>
  );
}

/** Ideas → product progression funnel. */
export function ProgressionFunnel({ steps }: { steps: { key: string; value: number }[] }) {
  const t = useT();
  const reduce = useReducedMotion();
  const max = Math.max(1, ...steps.map((s) => s.value));
  return (
    <figure role="img" aria-label={t("product.visuals.funnelLabel", { summary: steps.map((s) => `${t(`product.visuals.funnel.${s.key}`)} ${s.value}`).join(", ") })}>
      <ol className="grid gap-1.5" aria-hidden>
        {steps.map((s, i) => (
          <li key={s.key} className="grid grid-cols-[7rem_minmax(0,1fr)] items-center gap-2 text-xs">
            <span className="text-muted-foreground">{t(`product.visuals.funnel.${s.key}`)}</span>
            <div className="flex justify-center">
              <motion.div
                className="flex h-7 min-w-8 items-center justify-center rounded-md bg-brand-gradient text-xs font-semibold text-primary-foreground"
                style={{ width: `${Math.max(8, (s.value / max) * 100)}%`, opacity: 1 - i * 0.12 }}
                initial={reduce ? false : { scaleX: 0 }}
                animate={{ scaleX: 1 }}
                transition={{ duration: 0.7, delay: i * 0.12, ease: [0.16, 1, 0.3, 1] }}
              >
                {s.value}
              </motion.div>
            </div>
          </li>
        ))}
      </ol>
    </figure>
  );
}

/** Development activity: tasks completed (bars) and created (line) per week. */
export function ActivityChart({ weeks, locale }: { weeks: { start: string; done: number; created: number }[]; locale: string }) {
  const t = useT();
  const reduce = useReducedMotion();
  const W = 600;
  const H = 150;
  const max = Math.max(1, ...weeks.flatMap((w) => [w.done, w.created]));
  const bw = W / weeks.length;
  const y = (v: number) => H - (v / max) * (H - 12);
  const line = weeks.map((w, i) => `${i ? "L" : "M"}${i * bw + bw / 2},${y(w.created)}`).join(" ");
  const fmt = (d: string) => new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`));
  return (
    <figure role="img" aria-label={t("product.visuals.activityLabel", { done: weeks.reduce((a, w) => a + w.done, 0), created: weeks.reduce((a, w) => a + w.created, 0) })} className="grid gap-2">
      <svg viewBox={`0 0 ${W} ${H + 18}`} className="h-auto w-full" aria-hidden>
        {weeks.map((w, i) => (
          <motion.rect
            key={w.start}
            x={i * bw + bw * 0.2}
            width={bw * 0.6}
            y={y(w.done)}
            height={H - y(w.done)}
            rx={3}
            fill="var(--success)"
            initial={reduce ? false : { scaleY: 0 }}
            animate={{ scaleY: 1 }}
            style={{ transformOrigin: `0px ${H}px` }}
            transition={{ duration: 0.6, delay: i * 0.04 }}
          />
        ))}
        <motion.path d={line} fill="none" stroke="var(--primary)" strokeWidth={2} initial={reduce ? false : { pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.2 }} />
        {weeks.map((w, i) =>
          i % 2 === 0 ? (
            <text key={`l${w.start}`} x={i * bw + bw / 2} y={H + 14} textAnchor="middle" fontSize={10} fill="var(--muted-foreground)">
              {fmt(w.start)}
            </text>
          ) : null,
        )}
      </svg>
      <figcaption className="flex gap-3 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <span className="size-2.5 rounded-sm bg-success" aria-hidden />
          {t("product.visuals.done")}
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-0.5 w-3 bg-primary" aria-hidden />
          {t("product.visuals.created")}
        </span>
      </figcaption>
    </figure>
  );
}

/** Release process flow: each version placed in its step (planned → building → released → published). */
export function ReleaseFlow({ releases }: { releases: { id: string; version: string; step: number }[] }) {
  const t = useT();
  const anim = useAnim();
  const steps = ["planned", "building", "released", "published"] as const;
  if (!releases.length) return <p className="text-sm text-muted-foreground">{t("product.visuals.noReleases")}</p>;
  return (
    <figure role="img" aria-label={t("product.visuals.flowLabel", { summary: releases.map((r) => `${r.version}: ${t(`product.visuals.flow.${steps[r.step]}`)}`).join(", ") })}>
      <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-hidden>
        {steps.map((s, i) => (
          <li key={s} className="relative grid content-start gap-1.5 rounded-lg border bg-surface-2 p-2">
            <span className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
              <span className="grid size-5 place-items-center rounded-full bg-primary/10 text-[10px] text-primary">{i + 1}</span>
              {t(`product.visuals.flow.${s}`)}
            </span>
            {releases
              .filter((r) => r.step === i)
              .map((r, j) => (
                <motion.span key={r.id} {...anim(i * 0.15 + j * 0.05)} className="rounded-md border bg-surface px-2 py-1 font-mono text-xs">
                  {r.version}
                </motion.span>
              ))}
          </li>
        ))}
      </ol>
    </figure>
  );
}
