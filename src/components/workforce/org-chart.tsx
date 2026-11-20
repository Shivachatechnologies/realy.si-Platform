"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { motion } from "motion/react";
import { AlertTriangle, Crown } from "lucide-react";
import { AiAvatar, avatarPalette } from "@/components/graphics/ai-avatar";
import { useReducedMotion } from "@/components/motion/use-reduced-motion";
import { cn } from "@/lib/utils";

/** One AI employee in the chart, with real performance, budget and live state (labels pre-translated on the server). */
export interface OrgChartNode {
  id: string;
  name: string;
  department: string;
  departmentLabel: string;
  level: "EXECUTIVE" | "MANAGER" | "SPECIALIST";
  levelLabel: string;
  roleLabel: string;
  paused: boolean;
  /** Title of the task running now (null = idle). */
  working: string | null;
  queued: number;
  /** completed / (completed + failed) over the window; null without finished work. */
  successRate: number | null;
  completed: number;
  costLabel: string;
  /** Highest share of a budget used this month (0..1+), null without any budget. */
  budgetUse: number | null;
  openEscalations: number;
  autonomyMode: "suggest" | "supervised" | "autonomous";
  autonomyLabel: string;
  reports: OrgChartNode[];
}

export interface OrgChartLabels {
  founderRole: string;
  working: string;
  idle: string;
  paused: string;
  success: string;
  noTasks: string;
  budget: string;
  overBudget: string;
  escalations: string;
  allDepartments: string;
  filter: string;
  queued: string;
}

const NODE_W = 228;
const UNIT = 252;
const NODE_H = 118;
const GAP_Y = 64;
const STACK_H = 130;
const INDENT = 28;

interface Placed {
  node: OrgChartNode | null; // null = founder
  left: number;
  top: number;
  width: number;
  depth: number;
  parent: Placed | null;
  stacked: boolean;
}

/**
 * Tidy top-down layout: leaves take one column each, a parent is centred over its children; a manager whose reports
 * are all individual contributors gets them as a compact stacked column (keeps wide teams readable).
 */
function layout(roots: OrgChartNode[]) {
  const placed: Placed[] = [];
  const founder: Placed = { node: null, left: 0, top: 0, width: NODE_W, depth: 0, parent: null, stacked: false };
  placed.push(founder);
  let maxBottom = NODE_H;

  function place(n: OrgChartNode, depth: number, col: number, top: number, parent: Placed): { cols: number; self: Placed } {
    const self: Placed = { node: n, left: 0, top, width: NODE_W, depth, parent, stacked: false };
    placed.push(self);
    const kids = n.reports;
    if (!kids.length) {
      self.left = col * UNIT + (UNIT - NODE_W) / 2;
      maxBottom = Math.max(maxBottom, top + NODE_H);
      return { cols: 1, self };
    }
    if (kids.length > 1 && kids.every((k) => !k.reports.length)) {
      self.left = col * UNIT + (UNIT - NODE_W) / 2;
      kids.forEach((k, i) => {
        const p: Placed = { node: k, left: self.left + INDENT, top: top + NODE_H + GAP_Y / 2 + i * STACK_H, width: NODE_W - INDENT, depth: depth + 1, parent: self, stacked: true };
        placed.push(p);
        maxBottom = Math.max(maxBottom, p.top + NODE_H);
      });
      return { cols: 1, self };
    }
    let c = col;
    const children: Placed[] = [];
    for (const k of kids) {
      const r = place(k, depth + 1, c, top + NODE_H + GAP_Y, self);
      children.push(r.self);
      c += r.cols;
    }
    self.left = (children[0]!.left + children[children.length - 1]!.left) / 2;
    return { cols: c - col, self };
  }

  let col = 0;
  const top = NODE_H + GAP_Y;
  const rootPlaced: Placed[] = [];
  for (const r of roots) {
    const res = place(r, 1, col, top, founder);
    rootPlaced.push(res.self);
    col += res.cols;
  }
  const cols = Math.max(1, col);
  founder.left = rootPlaced.length ? (rootPlaced[0]!.left + rootPlaced[rootPlaced.length - 1]!.left) / 2 : (UNIT - NODE_W) / 2;
  return { placed, width: cols * UNIT, height: maxBottom + 8 };
}

function edgePath(from: Placed, to: Placed) {
  if (to.stacked) {
    const x = from.left + INDENT / 2;
    const y1 = from.top + NODE_H;
    const y2 = to.top + NODE_H / 2;
    return `M${x},${y1} L${x},${y2 - 10} Q${x},${y2} ${x + 10},${y2} L${to.left},${y2}`;
  }
  const x1 = from.left + from.width / 2;
  const y1 = from.top + NODE_H;
  const x2 = to.left + to.width / 2;
  const y2 = to.top;
  const my = (y1 + y2) / 2;
  return `M${x1},${y1} C${x1},${my} ${x2},${my} ${x2},${y2}`;
}

const pct = (v: number) => `${Math.round(v * 100)}%`;

/** Small success ring (real success rate; an empty track without finished work). */
function SuccessRing({ value, label }: { value: number | null; label: string }) {
  const r = 9;
  const c = 2 * Math.PI * r;
  const tone = value === null ? "text-muted-foreground" : value >= 0.8 ? "text-success" : value >= 0.5 ? "text-warning" : "text-danger";
  return (
    <span className="inline-flex items-center gap-1" title={label}>
      <svg viewBox="0 0 24 24" className={cn("size-5 -rotate-90", tone)} aria-hidden>
        <circle cx="12" cy="12" r={r} fill="none" stroke="currentColor" strokeOpacity="0.18" strokeWidth="3" />
        {value !== null ? <circle cx="12" cy="12" r={r} fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeDasharray={`${c * Math.min(1, value)} ${c}`} /> : null}
      </svg>
      <span className="tabular-nums">{value === null ? "—" : pct(value)}</span>
    </span>
  );
}

function NodeCard({ n, labels, href, dim, onFocus, compact }: { n: OrgChartNode; labels: OrgChartLabels; href: string; dim: boolean; onFocus: (id: string | null) => void; compact?: boolean }) {
  const p = avatarPalette(n.id, n.department);
  const over = n.budgetUse !== null && n.budgetUse >= 1;
  return (
    <Link
      href={href}
      onMouseEnter={() => onFocus(n.id)}
      onMouseLeave={() => onFocus(null)}
      onFocus={() => onFocus(n.id)}
      onBlur={() => onFocus(null)}
      className={cn(
        "group relative grid h-full content-between gap-1.5 overflow-hidden rounded-xl border bg-surface/90 p-2.5 text-start shadow-elev-1 backdrop-blur transition-[opacity,box-shadow,transform] duration-300 hover:-translate-y-0.5 hover:shadow-elev-2 focus-visible:outline-2 focus-visible:outline-primary motion-reduce:transition-none motion-reduce:hover:translate-y-0",
        dim && "opacity-35",
        n.paused && "grayscale-[0.6]",
      )}
      style={{ borderColor: n.working ? p.from : undefined }}
    >
      <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-1" style={{ background: `linear-gradient(90deg, ${p.from}, ${p.to})` }} />
      <span className="flex min-w-0 items-center gap-2">
        <AiAvatar seed={n.id} department={n.department} size={compact ? 32 : 38} active={!!n.working} />
        <span className="grid min-w-0 flex-1">
          <span className="truncate text-sm font-semibold" dir="auto">
            {n.name}
          </span>
          <span className="truncate text-[11px] text-muted-foreground" dir="auto">
            {n.roleLabel}
          </span>
        </span>
        {n.openEscalations ? (
          <span className="inline-flex items-center gap-0.5 rounded-full bg-warning/12 px-1.5 py-0.5 text-[10px] font-semibold text-warning" title={labels.escalations}>
            <AlertTriangle aria-hidden className="size-3" />
            {n.openEscalations}
          </span>
        ) : null}
      </span>
      <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
        <span className={cn("size-1.5 shrink-0 rounded-full", n.paused ? "bg-muted-foreground" : n.working ? "animate-pulse bg-success motion-reduce:animate-none" : "bg-border")} aria-hidden />
        <span className="truncate" dir="auto">
          {n.paused ? labels.paused : n.working ? `${labels.working}: ${n.working}` : n.queued ? `${labels.queued}: ${n.queued}` : labels.idle}
        </span>
      </span>
      <span className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <SuccessRing value={n.successRate} label={n.successRate === null ? labels.noTasks : `${labels.success} ${pct(n.successRate)}`} />
        <span className="tabular-nums" title={labels.budget}>
          {n.costLabel}
        </span>
        <span className="rounded-full border px-1.5 py-px text-[10px]" title={n.autonomyLabel}>
          {n.autonomyLabel}
        </span>
      </span>
      {n.budgetUse !== null ? (
        <span className="h-1 overflow-hidden rounded-full bg-muted" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(Math.min(1, n.budgetUse) * 100)} aria-label={over ? labels.overBudget : labels.budget}>
          <span className={cn("block h-full rounded-full", over ? "bg-danger" : n.budgetUse > 0.8 ? "bg-warning" : "bg-primary")} style={{ width: pct(Math.min(1, n.budgetUse)) }} />
        </span>
      ) : null}
    </Link>
  );
}

/**
 * Animated org chart: Founder → AI CEO → department managers → specialists. Connectors draw in, busy employees get a
 * flowing pulse along their reporting line, hovering an employee highlights its whole chain, and departments can be
 * filtered. Every number comes from real task rows. Small screens get an indented list instead of the canvas.
 */
export function OrgChart({ roots, founderName, labels, locale }: { roots: OrgChartNode[]; founderName: string; labels: OrgChartLabels; locale: string }) {
  const reduced = useReducedMotion();
  const [focus, setFocus] = useState<string | null>(null);
  const [dept, setDept] = useState<string | null>(null);
  const { placed, width, height } = useMemo(() => layout(roots), [roots]);

  const departments = useMemo(() => {
    const m = new Map<string, string>();
    const walk = (ns: OrgChartNode[]) => {
      for (const n of ns) {
        m.set(n.department, n.departmentLabel);
        walk(n.reports);
      }
    };
    walk(roots);
    return [...m.entries()];
  }, [roots]);

  /** The focused employee's chain: ancestors and all descendants. */
  const chain = useMemo(() => {
    if (!focus) return null;
    const ids = new Set<string>();
    const target = placed.find((p) => p.node?.id === focus);
    for (let p = target ?? null; p; p = p.parent) if (p.node) ids.add(p.node.id);
    const down = (n: OrgChartNode) => {
      for (const r of n.reports) {
        ids.add(r.id);
        down(r);
      }
    };
    if (target?.node) down(target.node);
    return ids;
  }, [focus, placed]);

  const dimmed = (n: OrgChartNode) => (chain ? !chain.has(n.id) : dept ? n.department !== dept : false);
  const href = (id: string) => `/${locale}/workforce/${id}`;

  return (
    <div className="grid gap-3">
      {departments.length > 1 ? (
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={labels.filter}>
          <button type="button" onClick={() => setDept(null)} aria-pressed={dept === null} className={cn("min-h-9 rounded-full border px-3 text-xs", dept === null ? "border-primary bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:text-foreground")}>
            {labels.allDepartments}
          </button>
          {departments.map(([key, label]) => {
            const p = avatarPalette(key, key);
            return (
              <button key={key} type="button" onClick={() => setDept(dept === key ? null : key)} aria-pressed={dept === key} className={cn("inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-xs", dept === key ? "border-primary bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:text-foreground")}>
                <span aria-hidden className="size-2 rounded-full" style={{ background: p.from }} />
                {label}
              </button>
            );
          })}
        </div>
      ) : null}

      {/* Canvas (md and up). Spatial diagram: laid out left-to-right regardless of reading direction. */}
      <div className="relative hidden overflow-x-auto rounded-2xl border bg-[radial-gradient(circle_at_50%_0%,var(--world-soft,var(--accent)),transparent_60%)] p-6 md:block">
        <div dir="ltr" className="relative mx-auto" style={{ width, height }}>
          <svg className="pointer-events-none absolute inset-0 text-border" width={width} height={height} aria-hidden>
            <defs>
              <linearGradient id="org-flow" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="var(--primary)" stopOpacity="0.15" />
                <stop offset="1" stopColor="var(--primary)" stopOpacity="0.6" />
              </linearGradient>
            </defs>
            {placed.map((p, i) => {
              if (!p.parent || !p.node) return null;
              const d = edgePath(p.parent, p);
              const lit = chain ? chain.has(p.node.id) && (!p.parent.node || chain.has(p.parent.node.id)) : dept ? p.node.department === dept : false;
              return (
                <g key={p.node.id}>
                  <motion.path
                    d={d}
                    fill="none"
                    stroke={lit ? "url(#org-flow)" : "currentColor"}
                    strokeWidth={lit ? 2.25 : 1.5}
                    initial={reduced ? false : { pathLength: 0, opacity: 0 }}
                    animate={{ pathLength: 1, opacity: 1 }}
                    transition={{ duration: 0.7, delay: 0.15 + p.depth * 0.18 + (i % 6) * 0.03, ease: "easeOut" }}
                  />
                  {p.node.working && !reduced ? (
                    <circle r="3.5" fill="var(--primary)">
                      <animateMotion dur="2.2s" repeatCount="indefinite" path={d} />
                    </circle>
                  ) : null}
                </g>
              );
            })}
          </svg>

          {placed.map((p) =>
            p.node ? (
              <motion.div
                key={p.node.id}
                className="absolute"
                style={{ left: p.left, top: p.top, width: p.width, height: NODE_H }}
                initial={reduced ? false : { opacity: 0, y: 12, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ duration: 0.45, delay: 0.1 + p.depth * 0.18, ease: "easeOut" }}
              >
                <NodeCard n={p.node} labels={labels} href={href(p.node.id)} dim={dimmed(p.node)} onFocus={setFocus} compact={p.stacked} />
              </motion.div>
            ) : (
              <motion.div
                key="founder"
                className="absolute"
                style={{ left: p.left, top: p.top, width: p.width, height: NODE_H }}
                initial={reduced ? false : { opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4 }}
              >
                <div className="relative grid h-full place-content-center justify-items-center gap-1 overflow-hidden rounded-xl border border-primary/40 bg-brand-gradient p-3 text-center text-primary-foreground shadow-glow">
                  <span className="grid size-9 place-items-center rounded-full bg-white/20">
                    <Crown aria-hidden className="size-5" />
                  </span>
                  <span className="max-w-full truncate text-sm font-semibold" dir="auto">
                    {founderName}
                  </span>
                  <span className="text-[11px] opacity-85">{labels.founderRole}</span>
                </div>
              </motion.div>
            ),
          )}
        </div>
      </div>

      {/* Small screens: indented list with the same data. */}
      <div className="grid gap-2 md:hidden">
        <div className="flex items-center gap-2 rounded-xl border border-primary/40 bg-brand-gradient p-3 text-primary-foreground">
          <Crown aria-hidden className="size-5" />
          <span className="grid">
            <span className="text-sm font-semibold">{founderName}</span>
            <span className="text-[11px] opacity-85">{labels.founderRole}</span>
          </span>
        </div>
        <MobileTree nodes={roots} labels={labels} href={href} dimmed={dimmed} />
      </div>
    </div>
  );
}

function MobileTree({ nodes, labels, href, dimmed }: { nodes: OrgChartNode[]; labels: OrgChartLabels; href: (id: string) => string; dimmed: (n: OrgChartNode) => boolean }) {
  return (
    <ul className="grid gap-2 border-s border-border ps-3">
      {nodes.map((n) => (
        <li key={n.id} className="grid gap-2">
          <div className="min-h-[7rem]">
            <NodeCard n={n} labels={labels} href={href(n.id)} dim={dimmed(n)} onFocus={() => {}} />
          </div>
          {n.reports.length ? <MobileTree nodes={n.reports} labels={labels} href={href} dimmed={dimmed} /> : null}
        </li>
      ))}
    </ul>
  );
}
