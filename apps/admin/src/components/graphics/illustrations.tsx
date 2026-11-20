import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { WorldName } from "@/components/ui/world";

/**
 * Hand-authored SVG illustration system — one distinct scene per module world, each drawing what the department
 * actually does (a pipeline for sales, a ledger for finance, an org tree for people…). They inherit the world's
 * accent tokens (wrapped in data-world, so they keep their identity anywhere), animate subtly with CSS
 * (static under reduced motion) and are decorative (aria-hidden) unless `title` is given.
 *
 *   <WorldIllustration world="finance" className="w-64" />
 *   <SalesIllustration />  …named exports for each world
 */

const A = "var(--world-accent, var(--primary))";
const B = "var(--world-accent-2, var(--primary-2))";
const INK = "var(--foreground)";
const SURF = "var(--surface)";
const LINE = "var(--border-strong)";

function Frame({ world, title, className, children }: { world: WorldName; title?: string; className?: string; children: ReactNode }) {
  const id = `il-${world}`;
  return (
    <span data-world={world} className={cn("inline-block", className)}>
      <svg viewBox="0 0 320 220" role={title ? "img" : undefined} aria-label={title} aria-hidden={title ? undefined : true} className="block h-auto w-full overflow-visible" fill="none">
        <defs>
          <linearGradient id={`${id}-ab`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor={A} />
            <stop offset="1" stopColor={B} />
          </linearGradient>
          <linearGradient id={`${id}-fade`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={A} stopOpacity="0.35" />
            <stop offset="1" stopColor={A} stopOpacity="0" />
          </linearGradient>
          <radialGradient id={`${id}-glow`}>
            <stop offset="0" stopColor={A} stopOpacity="0.45" />
            <stop offset="1" stopColor={A} stopOpacity="0" />
          </radialGradient>
          <linearGradient id={`${id}-card`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={SURF} stopOpacity="0.98" />
            <stop offset="1" stopColor={SURF} stopOpacity="0.78" />
          </linearGradient>
        </defs>
        {children}
      </svg>
    </span>
  );
}
const u = (world: WorldName, k: "ab" | "fade" | "glow" | "card") => `url(#il-${world}-${k})`;
type P = { className?: string; title?: string };

/** Command: a radar of the company — core, department satellites, sweeping scan. */
export function CommandIllustration({ className, title }: P) {
  const w = "command";
  const sats = [0, 1, 2, 3, 4, 5].map((i) => {
    const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
    return { x: 160 + Math.cos(a) * 78, y: 110 + Math.sin(a) * 78 };
  });
  return (
    <Frame world={w} title={title} className={className}>
      <circle cx="160" cy="110" r="100" fill={u(w, "glow")} opacity="0.6" />
      {[34, 58, 78, 98].map((r, i) => (
        <circle key={r} cx="160" cy="110" r={r} stroke={i === 2 ? A : LINE} strokeOpacity={i === 2 ? 0.6 : 0.5} strokeDasharray={i % 2 ? "2 5" : undefined} />
      ))}
      <g className="orbit-spin">
        <path d="M160 110 L160 12 A98 98 0 0 1 245 61 Z" fill={u(w, "fade")} opacity="0.55" />
      </g>
      {sats.map((s, i) => (
        <g key={i}>
          <path d={`M160 110 L${s.x} ${s.y}`} stroke={u(w, "ab")} strokeOpacity="0.5" className="dash-flow" />
          <rect x={s.x - 9} y={s.y - 9} width="18" height="18" rx="6" fill={SURF} stroke={i % 2 ? B : A} strokeWidth="1.5" />
          <circle cx={s.x} cy={s.y} r="3" fill={i % 2 ? B : A} className="blink-soft" style={{ animationDelay: `${i * 0.4}s` }} />
        </g>
      ))}
      <circle cx="160" cy="110" r="20" fill={u(w, "ab")} />
      <circle cx="160" cy="110" r="20" stroke={SURF} strokeOpacity="0.6" />
      <path d="M152 110h16M160 102v16" stroke={SURF} strokeWidth="2.4" strokeLinecap="round" />
    </Frame>
  );
}

/** Brain: documents orbiting a neural core, linked into a constellation. */
export function BrainIllustration({ className, title }: P) {
  const w = "brain";
  const docs = [
    { x: 48, y: 46, r: -8 },
    { x: 238, y: 34, r: 6 },
    { x: 30, y: 140, r: 5 },
    { x: 250, y: 140, r: -6 },
    { x: 140, y: 172, r: 2 },
  ];
  const stars = [
    [96, 30],
    [212, 92],
    [120, 140],
    [70, 98],
    [196, 160],
    [270, 96],
  ];
  return (
    <Frame world={w} title={title} className={className}>
      <circle cx="160" cy="100" r="80" fill={u(w, "glow")} />
      {stars.map(([x, y], i) => (
        <path key={i} d={`M160 100 L${x} ${y}`} stroke={u(w, "ab")} strokeOpacity="0.4" />
      ))}
      <path d="M96 30 L70 98 L120 140 L196 160 L212 92 L270 96" stroke={B} strokeOpacity="0.35" strokeDasharray="3 4" />
      {stars.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={i % 2 ? 2.5 : 3.5} fill={i % 2 ? B : A} className="blink-soft" style={{ animationDelay: `${i * 0.5}s` }} />
      ))}
      {docs.map((d, i) => (
        <g key={i} transform={`rotate(${d.r} ${d.x + 22} ${d.y + 15})`} className="float-slow" style={{ animationDelay: `${i * -1.7}s` }}>
          <rect x={d.x} y={d.y} width="44" height="32" rx="6" fill={u(w, "card")} stroke={LINE} />
          <path d={`M${d.x + 8} ${d.y + 10}h22M${d.x + 8} ${d.y + 16}h28M${d.x + 8} ${d.y + 22}h16`} stroke={INK} strokeOpacity="0.3" strokeLinecap="round" />
          <circle cx={d.x + 38} cy={d.y + 6} r="3" fill={i % 2 ? B : A} />
        </g>
      ))}
      <g>
        <path d="M160 72c-17 0-28 11-28 25 0 8 3 13 8 17v12c0 4 3 6 6 6h28c3 0 6-2 6-6v-12c5-4 8-9 8-17 0-14-11-25-28-25Z" fill={u(w, "ab")} />
        <path d="M148 92c4-6 8-6 12 0s8 6 12 0M146 106c5 5 9 5 14 0s9-5 14 0M160 80v44" stroke={SURF} strokeOpacity="0.8" strokeWidth="1.8" strokeLinecap="round" />
      </g>
    </Frame>
  );
}

/** Sales: a pipeline funnel narrowing stage by stage, deals moving, and a rising win trajectory. */
export function SalesIllustration({ className, title }: P) {
  const w = "sales";
  const stages = [
    { y: 34, w: 200 },
    { y: 74, w: 156 },
    { y: 114, w: 112 },
    { y: 154, w: 68 },
  ];
  return (
    <Frame world={w} title={title} className={className}>
      <ellipse cx="140" cy="196" rx="110" ry="10" fill={A} opacity="0.08" />
      {stages.map((s, i) => (
        <g key={i}>
          <rect x={140 - s.w / 2} y={s.y} width={s.w} height="30" rx="10" fill={u(w, "card")} stroke={i === 3 ? A : LINE} strokeWidth={i === 3 ? 1.6 : 1} />
          <rect x={140 - s.w / 2} y={s.y} width={s.w * (0.35 + i * 0.15)} height="30" rx="10" fill={u(w, "ab")} opacity={0.18 + i * 0.12} />
          {Array.from({ length: 4 - i }, (_, k) => (
            <circle key={k} cx={140 - s.w / 2 + 18 + k * 18} cy={s.y + 15} r="5" fill={k % 2 ? B : A} className="blink-soft" style={{ animationDelay: `${(i + k) * 0.3}s` }} />
          ))}
        </g>
      ))}
      <path d="M140 64v8M140 104v8M140 144v8" stroke={A} strokeWidth="2" strokeLinecap="round" />
      <path d="M232 170 L252 140 L268 150 L300 92" stroke={u(w, "ab")} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="draw-in" style={{ ["--len" as string]: 140 }} />
      <path d="M288 92h12v12" stroke={B} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <g className="float-slow">
        <rect x="236" y="40" width="64" height="36" rx="9" fill={u(w, "card")} stroke={LINE} />
        <path d="M246 52h26" stroke={INK} strokeOpacity="0.35" strokeLinecap="round" />
        <path d="M246 63h18" stroke={A} strokeWidth="3" strokeLinecap="round" />
        <circle cx="288" cy="58" r="6" fill={A} />
        <path d="M285 58l2 2 4-4" stroke={SURF} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </g>
    </Frame>
  );
}

/** Marketing: a broadcast source sending waves to an audience field, with a campaign card. */
export function MarketingIllustration({ className, title }: P) {
  const w = "marketing";
  const audience = Array.from({ length: 18 }, (_, i) => ({ x: 196 + (i % 6) * 18 + (Math.floor(i / 6) % 2) * 9, y: 66 + Math.floor(i / 6) * 30 }));
  return (
    <Frame world={w} title={title} className={className}>
      <circle cx="78" cy="110" r="90" fill={u(w, "glow")} opacity="0.7" />
      {[30, 52, 76, 102].map((r, i) => (
        <path key={r} d={`M${78 + r * 0.5} ${110 - r * 0.87} A${r} ${r} 0 0 1 ${78 + r * 0.5} ${110 + r * 0.87}`} stroke={i % 2 ? B : A} strokeOpacity={0.75 - i * 0.15} strokeWidth="2.2" strokeLinecap="round" className="blink-soft" style={{ animationDelay: `${i * 0.35}s` }} />
      ))}
      <circle cx="78" cy="110" r="16" fill={u(w, "ab")} />
      <path d="M71 104v12l13 6V98z" fill={SURF} />
      {audience.map((p, i) => (
        <g key={i}>
          <circle cx={p.x} cy={p.y} r="6" fill={i % 4 === 0 ? A : i % 3 === 0 ? B : LINE} opacity={i % 4 === 0 || i % 3 === 0 ? 0.95 : 0.6} />
          <path d={`M${p.x - 7} ${p.y + 14}a7 6 0 0 1 14 0`} fill={i % 4 === 0 ? A : LINE} opacity="0.4" />
        </g>
      ))}
      <g className="float-slow">
        <rect x="104" y="150" width="96" height="48" rx="10" fill={u(w, "card")} stroke={LINE} />
        <rect x="112" y="158" width="28" height="32" rx="6" fill={u(w, "ab")} opacity="0.85" />
        <path d="M148 164h42M148 174h32M148 184h20" stroke={INK} strokeOpacity="0.3" strokeLinecap="round" />
      </g>
    </Frame>
  );
}

/** Finance: ledger rows, a balance bar chart and a cash-flow line on a grid. */
export function FinanceIllustration({ className, title }: P) {
  const w = "finance";
  const bars = [46, 70, 58, 92, 80, 118];
  return (
    <Frame world={w} title={title} className={className}>
      {[0, 1, 2, 3, 4].map((i) => (
        <path key={i} d={`M24 ${40 + i * 34}H296`} stroke={LINE} strokeOpacity="0.45" strokeDasharray={i === 4 ? undefined : "2 6"} />
      ))}
      {bars.map((h, i) => (
        <rect key={i} x={40 + i * 40} y={176 - h} width="22" height={h} rx="5" fill={i === bars.length - 1 ? u(w, "ab") : A} opacity={i === bars.length - 1 ? 1 : 0.22 + i * 0.08} />
      ))}
      <path d="M51 140 C 90 128, 110 132, 131 112 S 180 96, 211 84 S 260 52, 271 48" stroke={B} strokeWidth="2.6" strokeLinecap="round" className="draw-in" style={{ ["--len" as string]: 260 }} />
      {[
        [51, 140],
        [131, 112],
        [211, 84],
        [271, 48],
      ].map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="4" fill={SURF} stroke={B} strokeWidth="2" />
      ))}
      <g className="float-slow">
        <rect x="196" y="122" width="100" height="72" rx="10" fill={u(w, "card")} stroke={LINE} />
        {[0, 1, 2].map((i) => (
          <g key={i}>
            <path d={`M206 ${138 + i * 18}h40`} stroke={INK} strokeOpacity="0.3" strokeLinecap="round" />
            <path d={`M262 ${138 + i * 18}h${24 - i * 6}`} stroke={i === 2 ? A : INK} strokeOpacity={i === 2 ? 1 : 0.5} strokeWidth="2.4" strokeLinecap="round" />
          </g>
        ))}
      </g>
      <g className="spin-local">
        <circle cx="52" cy="44" r="16" fill={u(w, "ab")} />
        <circle cx="52" cy="44" r="11" stroke={SURF} strokeOpacity="0.6" strokeDasharray="3 3" />
      </g>
    </Frame>
  );
}

/** People: an organisation tree of people connected to their teams. */
export function PeopleIllustration({ className, title }: P) {
  const w = "people";
  const person = (x: number, y: number, s: number, c: string, k: number) => (
    <g key={`${x}-${y}`}>
      <circle cx={x} cy={y} r={s + 6} fill={c} opacity="0.12" />
      <circle cx={x} cy={y - s * 0.25} r={s * 0.42} fill={c} />
      <path d={`M${x - s * 0.7} ${y + s * 0.75}a${s * 0.7} ${s * 0.6} 0 0 1 ${s * 1.4} 0`} fill={c} opacity="0.75" />
      <circle cx={x + s * 0.75} cy={y - s * 0.7} r="3" fill={SURF} stroke={c} className="blink-soft" style={{ animationDelay: `${k * 0.4}s` }} />
    </g>
  );
  return (
    <Frame world={w} title={title} className={className}>
      <path d="M160 58v26M80 84h160M80 84v26M160 84v26M240 84v26M80 140v14M56 154h48M240 140v14M216 154h48" stroke={u(w, "ab")} strokeOpacity="0.55" strokeWidth="1.6" strokeLinecap="round" />
      {person(160, 36, 22, A, 0)}
      {person(80, 124, 18, B, 1)}
      {person(160, 124, 18, A, 2)}
      {person(240, 124, 18, B, 3)}
      {person(56, 176, 13, A, 4)}
      {person(104, 176, 13, B, 5)}
      {person(216, 176, 13, A, 6)}
      {person(264, 176, 13, B, 7)}
      <g className="float-slow">
        <rect x="128" y="160" width="64" height="40" rx="10" fill={u(w, "card")} stroke={LINE} />
        <path d="M138 174h24M138 184h40" stroke={INK} strokeOpacity="0.3" strokeLinecap="round" />
        <circle cx="180" cy="172" r="5" fill={A} />
      </g>
    </Frame>
  );
}

/** Projects: a timeline of task bars with dependencies and milestone diamonds. */
export function ProjectsIllustration({ className, title }: P) {
  const w = "projects";
  const rows = [
    { x: 40, w: 92, done: 1 },
    { x: 96, w: 110, done: 0.8 },
    { x: 150, w: 84, done: 0.4 },
    { x: 196, w: 92, done: 0.1 },
  ];
  return (
    <Frame world={w} title={title} className={className}>
      {[0, 1, 2, 3, 4, 5, 6].map((i) => (
        <path key={i} d={`M${40 + i * 42} 26V196`} stroke={LINE} strokeOpacity="0.4" strokeDasharray="2 5" />
      ))}
      <path d="M168 20V200" stroke={A} strokeWidth="1.5" />
      <circle cx="168" cy="20" r="4" fill={A} className="blink-soft" />
      {rows.map((r, i) => (
        <g key={i}>
          <rect x={r.x} y={44 + i * 38} width={r.w} height="22" rx="8" fill={u(w, "card")} stroke={LINE} />
          <rect x={r.x} y={44 + i * 38} width={r.w * r.done} height="22" rx="8" fill={u(w, "ab")} opacity={0.35 + r.done * 0.5} />
          {i < rows.length - 1 ? <path d={`M${r.x + r.w} ${55 + i * 38} h8 v38 H${rows[i + 1]!.x}`} stroke={B} strokeOpacity="0.6" strokeDasharray="3 3" className="dash-flow" /> : null}
        </g>
      ))}
      {[
        [132, 30],
        [288, 196],
      ].map(([x, y], i) => (
        <path key={i} d={`M${x} ${y - 8} l8 8 -8 8 -8 -8z`} fill={i ? SURF : B} stroke={B} strokeWidth="1.6" />
      ))}
    </Frame>
  );
}

/** Product: modular isometric blocks assembling along a roadmap path. */
export function ProductIllustration({ className, title }: P) {
  const w = "product";
  const cube = (x: number, y: number, s: number, o: number, k: number) => (
    <g key={`${x}-${y}`} className={k % 2 ? "float-slow" : undefined} style={{ animationDelay: `${k * -2}s` }}>
      <path d={`M${x} ${y - s}l${s} ${s / 2}-${s} ${s / 2}-${s}-${s / 2}z`} fill={A} opacity={o} />
      <path d={`M${x - s} ${y - s / 2}v${s}l${s} ${s / 2}v-${s}z`} fill={u(w, "ab")} opacity={o * 0.85} />
      <path d={`M${x + s} ${y - s / 2}v${s}l-${s} ${s / 2}v-${s}z`} fill={B} opacity={o * 0.6} />
    </g>
  );
  return (
    <Frame world={w} title={title} className={className}>
      <path d="M30 190 C 90 190, 80 130, 150 130 S 220 70, 300 60" stroke={LINE} strokeWidth="1.5" strokeDasharray="4 5" />
      <path d="M30 190 C 90 190, 80 130, 150 130" stroke={u(w, "ab")} strokeWidth="2.6" strokeLinecap="round" className="draw-in" style={{ ["--len" as string]: 170 }} />
      {[
        [30, 190],
        [150, 130],
        [300, 60],
      ].map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="5" fill={i < 2 ? A : SURF} stroke={A} strokeWidth="2" />
      ))}
      {cube(160, 84, 26, 1, 0)}
      {cube(212, 110, 20, 0.85, 1)}
      {cube(110, 74, 18, 0.7, 2)}
      {cube(250, 160, 16, 0.55, 3)}
      <g className="float-slow">
        <rect x="40" y="26" width="72" height="34" rx="9" fill={u(w, "card")} stroke={LINE} />
        <path d="M50 38h30M50 48h46" stroke={INK} strokeOpacity="0.3" strokeLinecap="round" />
        <circle cx="100" cy="38" r="4" fill={B} />
      </g>
    </Frame>
  );
}

/** Support: conversations converging into resolution — chat bubbles, a headset ring and a check. */
export function SupportIllustration({ className, title }: P) {
  const w = "support";
  return (
    <Frame world={w} title={title} className={className}>
      <circle cx="210" cy="110" r="84" fill={u(w, "glow")} />
      {[40, 62, 84].map((r, i) => (
        <circle key={r} cx="210" cy="110" r={r} stroke={i ? LINE : A} strokeOpacity={i ? 0.45 : 0.7} strokeDasharray={i === 2 ? "2 6" : undefined} />
      ))}
      <path d="M182 112v-6a28 28 0 0 1 56 0v6" stroke={u(w, "ab")} strokeWidth="5" strokeLinecap="round" />
      <rect x="174" y="108" width="14" height="24" rx="6" fill={A} />
      <rect x="232" y="108" width="14" height="24" rx="6" fill={B} />
      <circle cx="210" cy="112" r="14" fill={u(w, "ab")} />
      <path d="M203 112l5 5 9-9" stroke={SURF} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      {[
        { x: 28, y: 36, w: 92, a: true },
        { x: 52, y: 92, w: 76, a: false },
        { x: 20, y: 146, w: 100, a: true },
      ].map((b, i) => (
        <g key={i} className="float-slow" style={{ animationDelay: `${i * -2.5}s` }}>
          <path d={`M${b.x} ${b.y}h${b.w}a8 8 0 0 1 8 8v18a8 8 0 0 1-8 8H${b.x + 22}l-10 9v-9h-4a8 8 0 0 1-8-8V${b.y + 8}a8 8 0 0 1 8-8z`} fill={u(w, "card")} stroke={b.a ? A : LINE} />
          <path d={`M${b.x + 10} ${b.y + 13}h${b.w - 30}M${b.x + 10} ${b.y + 23}h${b.w - 50}`} stroke={INK} strokeOpacity="0.3" strokeLinecap="round" />
          <path d={`M${b.x + b.w + 10} ${b.y + 17} Q 160 ${b.y + 17} 176 112`} stroke={b.a ? A : B} strokeOpacity="0.5" className="dash-flow" />
        </g>
      ))}
    </Frame>
  );
}

/** Automation: a workflow — trigger, branching conditions, gears and actions. */
export function AutomationIllustration({ className, title }: P) {
  const w = "automation";
  const node = (x: number, y: number, label: "t" | "c" | "a", k: number) => (
    <g key={`${x}-${y}`}>
      <rect x={x - 26} y={y - 16} width="52" height="32" rx={label === "c" ? 16 : 9} fill={u(w, "card")} stroke={label === "t" ? A : LINE} strokeWidth={label === "t" ? 1.6 : 1} />
      {label === "t" ? <path d={`M${x - 4} ${y - 8}l-6 9h8l-4 8 12-11h-8l4-6z`} fill={A} /> : label === "c" ? <path d={`M${x - 9} ${y}l9-8 9 8-9 8z`} fill={B} /> : <circle cx={x} cy={y} r="6" fill={A} className="blink-soft" style={{ animationDelay: `${k * 0.5}s` }} />}
    </g>
  );
  const gear = (cx: number, cy: number, r: number, cls: string) => (
    <g className={cls}>
      <path
        d={
          Array.from({ length: 10 }, (_, i) => {
            const a1 = (i / 10) * Math.PI * 2;
            const a2 = a1 + Math.PI / 10;
            return `${i ? "L" : "M"}${cx + Math.cos(a1) * r} ${cy + Math.sin(a1) * r}L${cx + Math.cos(a2) * r * 0.78} ${cy + Math.sin(a2) * r * 0.78}`;
          }).join("") + "Z"
        }
        fill={u(w, "ab")}
        opacity="0.9"
      />
      <circle cx={cx} cy={cy} r={r * 0.32} fill={SURF} />
    </g>
  );
  return (
    <Frame world={w} title={title} className={className}>
      <path d="M66 110H110M162 110 C 186 110, 186 60, 214 60M162 110 C 186 110, 186 160, 214 160M266 60H290M266 160H290" stroke={u(w, "ab")} strokeWidth="1.8" className="dash-flow" />
      {node(40, 110, "t", 0)}
      {node(136, 110, "c", 1)}
      {node(240, 60, "a", 2)}
      {node(240, 160, "a", 3)}
      {gear(290, 60, 14, "spin-local")}
      {gear(292, 160, 11, "spin-local")}
      {gear(120, 36, 18, "spin-local")}
      <circle cx="40" cy="110" r="34" stroke={A} strokeOpacity="0.25" strokeDasharray="2 5" />
    </Frame>
  );
}

/** Integrations: a hub with connector plugs reaching to external services. */
export function IntegrationsIllustration({ className, title }: P) {
  const w = "integrations";
  const spokes = Array.from({ length: 8 }, (_, i) => {
    const a = (i / 8) * Math.PI * 2 + 0.2;
    return { x: 160 + Math.cos(a) * 96, y: 110 + Math.sin(a) * 76, a };
  });
  return (
    <Frame world={w} title={title} className={className}>
      <ellipse cx="160" cy="110" rx="120" ry="92" fill={u(w, "glow")} opacity="0.7" />
      <ellipse cx="160" cy="110" rx="96" ry="76" stroke={LINE} strokeDasharray="2 6" />
      {spokes.map((s, i) => (
        <g key={i}>
          <path d={`M160 110 L${s.x} ${s.y}`} stroke={i % 3 === 0 ? LINE : u(w, "ab")} strokeOpacity={i % 3 === 0 ? 0.6 : 0.7} strokeDasharray={i % 3 === 0 ? "3 4" : undefined} className={i % 3 === 0 ? undefined : "dash-flow"} />
          <rect x={s.x - 14} y={s.y - 14} width="28" height="28" rx="8" fill={u(w, "card")} stroke={i % 3 === 0 ? LINE : i % 2 ? B : A} strokeWidth="1.4" />
          {i % 4 === 0 ? <circle cx={s.x} cy={s.y} r="5" fill={A} /> : i % 4 === 1 ? <rect x={s.x - 5} y={s.y - 5} width="10" height="10" rx="2" fill={B} /> : i % 4 === 2 ? <path d={`M${s.x - 6} ${s.y + 4}l6-10 6 10z`} fill={A} /> : <path d={`M${s.x - 6} ${s.y}h12M${s.x} ${s.y - 6}v12`} stroke={B} strokeWidth="2.4" strokeLinecap="round" />}
        </g>
      ))}
      <rect x="132" y="82" width="56" height="56" rx="16" fill={u(w, "ab")} />
      <path d="M152 98v10M168 98v10M146 108h28v6a14 14 0 0 1-28 0z M160 128v6" stroke={SURF} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </Frame>
  );
}

/** Marketplace: a gallery wall of app tiles, one lifted and being installed. */
export function MarketplaceIllustration({ className, title }: P) {
  const w = "marketplace";
  const tiles = Array.from({ length: 12 }, (_, i) => ({ x: 36 + (i % 4) * 64, y: 30 + Math.floor(i / 4) * 58, i }));
  return (
    <Frame world={w} title={title} className={className}>
      {tiles.map((t) =>
        t.i === 6 ? null : (
          <g key={t.i}>
            <rect x={t.x} y={t.y} width="52" height="46" rx="10" fill={u(w, "card")} stroke={LINE} />
            <rect x={t.x + 8} y={t.y + 8} width="14" height="14" rx="4" fill={t.i % 3 === 0 ? A : t.i % 3 === 1 ? B : LINE} opacity={t.i % 3 === 2 ? 0.7 : 0.85} />
            <path d={`M${t.x + 8} ${t.y + 32}h${22 + (t.i % 3) * 6}`} stroke={INK} strokeOpacity="0.25" strokeLinecap="round" />
          </g>
        ),
      )}
      <rect x="164" y="146" width="52" height="46" rx="10" stroke={A} strokeDasharray="3 4" strokeOpacity="0.7" />
      <g className="float-slow">
        <rect x="150" y="70" width="80" height="70" rx="14" fill={u(w, "card")} stroke={A} strokeWidth="1.6" />
        <rect x="162" y="82" width="26" height="26" rx="8" fill={u(w, "ab")} />
        <path d="M196 88h22M196 98h14" stroke={INK} strokeOpacity="0.35" strokeLinecap="round" />
        <rect x="162" y="116" width="56" height="14" rx="7" fill={A} />
        <path d="M186 123h8M190 119v8" stroke={SURF} strokeWidth="1.8" strokeLinecap="round" />
      </g>
      <path d="M190 146v-4" stroke={A} strokeWidth="2" strokeLinecap="round" className="blink-soft" />
    </Frame>
  );
}

/** Settings: a control panel of sliders and toggles guarded by a shield. */
export function SettingsIllustration({ className, title }: P) {
  const w = "settings";
  return (
    <Frame world={w} title={title} className={className}>
      <rect x="36" y="30" width="170" height="160" rx="18" fill={u(w, "card")} stroke={LINE} />
      {[0, 1, 2, 3].map((i) => {
        const v = [0.7, 0.35, 0.55, 0.85][i]!;
        return (
          <g key={i}>
            <path d={`M56 ${62 + i * 36}H186`} stroke={LINE} strokeWidth="4" strokeLinecap="round" />
            <path d={`M56 ${62 + i * 36}H${56 + 130 * v}`} stroke={u(w, "ab")} strokeWidth="4" strokeLinecap="round" />
            <circle cx={56 + 130 * v} cy={62 + i * 36} r="8" fill={SURF} stroke={A} strokeWidth="2" />
          </g>
        );
      })}
      <g className="float-slow">
        <path d="M252 44l36 14v30c0 26-16 46-36 54-20-8-36-28-36-54V58z" fill={u(w, "ab")} />
        <path d="M238 92l10 10 18-20" stroke={SURF} strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
      </g>
      <rect x="222" y="160" width="40" height="22" rx="11" fill={A} />
      <circle cx="251" cy="171" r="8" fill={SURF} />
      <rect x="268" y="160" width="40" height="22" rx="11" fill={LINE} />
      <circle cx="279" cy="171" r="8" fill={SURF} />
    </Frame>
  );
}

const BY_WORLD: Record<WorldName, (p: P) => React.JSX.Element> = {
  command: CommandIllustration,
  brain: BrainIllustration,
  sales: SalesIllustration,
  marketing: MarketingIllustration,
  finance: FinanceIllustration,
  people: PeopleIllustration,
  projects: ProjectsIllustration,
  product: ProductIllustration,
  support: SupportIllustration,
  automation: AutomationIllustration,
  integrations: IntegrationsIllustration,
  marketplace: MarketplaceIllustration,
  settings: SettingsIllustration,
};

/** The world's own illustration (headers, empty states, artwork fallbacks). */
export function WorldIllustration({ world, className, title }: P & { world: WorldName }) {
  const C = BY_WORLD[world];
  return <C className={className} title={title} />;
}
