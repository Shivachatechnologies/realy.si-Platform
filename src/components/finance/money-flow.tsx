import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * "Where the money comes from and where it goes" — a Sankey-style SVG drawn from real ledger totals: income streams on
 * the start side flow into the company, which pays out to expense streams (+ profit kept) on the end side. Ribbon widths
 * are proportional to the amounts. Pure SVG (works in Server Components), reduced-motion safe (only a CSS fade), with a
 * text list underneath so screen readers and small screens get the same numbers.
 */
export interface FlowItem {
  key: string;
  label: string;
  amount: string;
  value: number;
  kind: "income" | "expense" | "profit" | "loss" | "other_income" | "other_expense";
  href?: string;
}

const COLOR: Record<FlowItem["kind"], string> = {
  income: "var(--success)",
  other_income: "color-mix(in oklch, var(--success) 55%, var(--muted-foreground))",
  loss: "var(--warning)",
  expense: "var(--danger)",
  other_expense: "color-mix(in oklch, var(--danger) 55%, var(--muted-foreground))",
  profit: "var(--primary)",
};

const W = 960;
const BAR = 14;
const GAP = 12;
const CENTER_W = 22;

function layout(items: FlowItem[], scale: number, height: number) {
  const usable = height - GAP * Math.max(0, items.length - 1);
  let y = 0;
  return items.map((it) => {
    const h = Math.max(3, (it.value / (scale || 1)) * usable);
    const node = { ...it, y, h };
    y += h + GAP;
    return node;
  });
}

export function MoneyFlow({
  sources,
  uses,
  centerLabel,
  centerAmount,
  title,
  emptyText,
  legend,
  className,
}: {
  sources: FlowItem[];
  uses: FlowItem[];
  centerLabel: string;
  centerAmount: string;
  title: string;
  emptyText: string;
  legend: { in: string; out: string };
  className?: string;
}) {
  const scaleIn = sources.reduce((s, n) => s + n.value, 0);
  const scaleOut = uses.reduce((s, n) => s + n.value, 0);
  const scale = Math.max(scaleIn, scaleOut);
  if (!scale) return <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">{emptyText}</p>;
  const rows = Math.max(sources.length, uses.length);
  const H = Math.max(220, Math.min(460, rows * 58));
  const left = layout(sources, scale, H);
  const right = layout(uses, scale, H);
  const leftTotal = left.length ? left[left.length - 1]!.y + left[left.length - 1]!.h : 0;
  const rightTotal = right.length ? right[right.length - 1]!.y + right[right.length - 1]!.h : 0;
  const centerH = H - GAP * Math.max(0, rows - 1);
  const centerY = (H - centerH) / 2;
  const cx = W / 2 - CENTER_W / 2;
  const ribbon = (x0: number, y0: number, h0: number, x1: number, y1: number, h1: number) => {
    const mx = (x0 + x1) / 2;
    return `M${x0},${y0} C${mx},${y0} ${mx},${y1} ${x1},${y1} L${x1},${y1 + h1} C${mx},${y1 + h1} ${mx},${y0 + h0} ${x0},${y0 + h0} Z`;
  };
  const leftOffset = (H - leftTotal) / 2;
  const rightOffset = (H - rightTotal) / 2;
  // Ribbon slots on the company bar, stacked in the same order as the nodes (centred when one side is smaller).
  const slots = (nodes: typeof left, total: number) => {
    let cursor = centerY + Math.max(0, (centerH - (total / scale) * centerH) / 2);
    return nodes.map((n) => {
      const h = (n.value / scale) * centerH;
      const y = cursor;
      cursor += h;
      return { n, y, h };
    });
  };
  const inSlots = slots(left, scaleIn);
  const outSlots = slots(right, scaleOut);

  return (
    <figure className={cn("grid gap-4", className)}>
      <div className="overflow-x-auto">
        <svg viewBox={`0 0 ${W} ${H + 8}`} role="img" aria-label={title} className="min-w-[560px] animate-fade-in" preserveAspectRatio="xMidYMid meet">
          <title>{title}</title>
          <defs>
            <linearGradient id="mf-center" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor="var(--primary)" stopOpacity="0.95" />
              <stop offset="1" stopColor="var(--success)" stopOpacity="0.85" />
            </linearGradient>
          </defs>
          <g transform="translate(0,4)">
            {inSlots.map(({ n, y, h }) => {
              const d = ribbon(BAR, leftOffset + n.y, n.h, cx, y, h);
              return (
                <path key={`r-${n.key}`} d={d} fill={COLOR[n.kind]} fillOpacity={0.22} stroke={COLOR[n.kind]} strokeOpacity={0.35} strokeWidth={0.6}>
                  <title>{`${n.label}: ${n.amount}`}</title>
                </path>
              );
            })}
            {outSlots.map(({ n, y, h }) => {
              const d = ribbon(cx + CENTER_W, y, h, W - BAR, rightOffset + n.y, n.h);
              return (
                <path key={`r-${n.key}`} d={d} fill={COLOR[n.kind]} fillOpacity={0.22} stroke={COLOR[n.kind]} strokeOpacity={0.35} strokeWidth={0.6}>
                  <title>{`${n.label}: ${n.amount}`}</title>
                </path>
              );
            })}
            <rect x={cx} y={centerY} width={CENTER_W} height={centerH} rx={5} fill="url(#mf-center)" />
            {left.map((n) => (
              <g key={`n-${n.key}`}>
                <rect x={0} y={leftOffset + n.y} width={BAR} height={n.h} rx={3} fill={COLOR[n.kind]} />
                <text x={BAR + 8} y={leftOffset + n.y + n.h / 2} dominantBaseline="middle" className="fill-foreground text-[13px] font-medium" style={{ paintOrder: "stroke", stroke: "var(--surface)", strokeWidth: 4 }}>
                  {n.label}
                  <tspan className="fill-muted-foreground font-normal" dx={6}>
                    {n.amount}
                  </tspan>
                </text>
              </g>
            ))}
            {right.map((n) => (
              <g key={`n-${n.key}`}>
                <rect x={W - BAR} y={rightOffset + n.y} width={BAR} height={n.h} rx={3} fill={COLOR[n.kind]} />
                <text x={W - BAR - 8} y={rightOffset + n.y + n.h / 2} dominantBaseline="middle" textAnchor="end" className="fill-foreground text-[13px] font-medium" style={{ paintOrder: "stroke", stroke: "var(--surface)", strokeWidth: 4 }}>
                  {n.label}
                  <tspan className="fill-muted-foreground font-normal" dx={6}>
                    {n.amount}
                  </tspan>
                </text>
              </g>
            ))}
            <text x={W / 2} y={Math.max(14, centerY - 10)} textAnchor="middle" className="fill-foreground text-[13px] font-semibold" style={{ paintOrder: "stroke", stroke: "var(--surface)", strokeWidth: 4 }}>
              {centerLabel}
            </text>
            <text x={W / 2} y={Math.min(H, centerY + centerH + 16)} textAnchor="middle" className="fill-muted-foreground text-[12px]" style={{ paintOrder: "stroke", stroke: "var(--surface)", strokeWidth: 4 }}>
              {centerAmount}
            </text>
          </g>
        </svg>
      </div>
      <figcaption className="grid gap-3 text-sm sm:grid-cols-2">
        {[
          { label: legend.in, items: sources },
          { label: legend.out, items: uses },
        ].map((col) => (
          <div key={col.label} className="grid content-start gap-1">
            <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{col.label}</p>
            <ul className="grid gap-1">
              {col.items.map((n) => (
                <li key={n.key} className="flex items-center gap-2">
                  <span aria-hidden className="size-2.5 shrink-0 rounded-sm" style={{ background: COLOR[n.kind] }} />
                  {n.href ? (
                    <Link href={n.href} className="min-w-0 flex-1 truncate hover:underline">
                      {n.label}
                    </Link>
                  ) : (
                    <span className="min-w-0 flex-1 truncate">{n.label}</span>
                  )}
                  <span className="tabular-nums text-muted-foreground">{n.amount}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </figcaption>
    </figure>
  );
}
