import { cn } from "@/lib/utils";
import { hash, rng } from "./color";

/**
 * Deterministic avatars for AI employees. The department picks the shape family (so a glance tells you the role):
 *   sales → faceted arrow · marketing → broadcast waves · finance → hexagon ledger · hr/people → petals ·
 *   support → speech bubble · projects → stacked blocks · product → isometric cube · executive → crown star ·
 *   operations/automation → gear · ai/default → orbit.
 * The seed (employee id or name) picks hue shift, rotation and inner pattern, so every employee is unique and
 * always looks the same. Pure SVG — works in server and client components. `active` adds a live ring.
 */
export type AvatarFamily = "sales" | "marketing" | "finance" | "people" | "support" | "projects" | "product" | "executive" | "operations" | "ai";

export function avatarFamily(department: string | null | undefined): AvatarFamily {
  const d = (department ?? "").toLowerCase();
  if (/sales|crm|deal/.test(d)) return "sales";
  if (/market|brand|content|growth/.test(d)) return "marketing";
  if (/financ|account|billing|cfo/.test(d)) return "finance";
  if (/hr|people|talent|recruit/.test(d)) return "people";
  if (/support|success|service/.test(d)) return "support";
  if (/project|delivery|pm/.test(d)) return "projects";
  if (/product|engineer|develop/.test(d)) return "product";
  if (/exec|ceo|strategy|leader/.test(d)) return "executive";
  if (/operat|automation|workflow|ops/.test(d)) return "operations";
  return "ai";
}

/** Base hue per family (oklch degrees). */
const FAMILY_HUE: Record<AvatarFamily, number> = {
  sales: 158,
  marketing: 350,
  finance: 82,
  people: 28,
  support: 178,
  projects: 238,
  product: 205,
  executive: 290,
  operations: 128,
  ai: 270,
};

/** Palette for an avatar (exported so other modules can tint cards/badges to match). */
export function avatarPalette(seed: string, department?: string | null) {
  const fam = avatarFamily(department);
  const r = rng(hash(seed));
  const hue = (FAMILY_HUE[fam] + (r() - 0.5) * 36 + 360) % 360;
  return {
    family: fam,
    hue,
    from: `oklch(0.7 0.16 ${hue.toFixed(1)})`,
    to: `oklch(0.5 0.19 ${((hue + 40) % 360).toFixed(1)})`,
    ink: `oklch(0.98 0.02 ${hue.toFixed(1)})`,
    soft: `oklch(0.7 0.16 ${hue.toFixed(1)} / 0.18)`,
  };
}

function Glyph({ fam, r }: { fam: AvatarFamily; r: () => number }) {
  const k = r();
  switch (fam) {
    case "sales":
      return <path d={`M18 ${44 - k * 4}L32 18L46 ${44 - k * 4}L32 36Z`} fill="currentColor" fillOpacity="0.92" />;
    case "marketing":
      return (
        <g fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round">
          <circle cx="22" cy="40" r="3.2" fill="currentColor" stroke="none" />
          <path d="M22 30a10 10 0 0 1 10 10" />
          <path d="M22 21a19 19 0 0 1 19 19" opacity="0.75" />
          {k > 0.4 ? <path d="M22 13a27 27 0 0 1 27 27" opacity="0.45" /> : null}
        </g>
      );
    case "finance":
      return (
        <g>
          <path d="M32 15l14 8v16l-14 8-14-8V23z" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinejoin="round" />
          <path d={`M25 37v-5M32 37v-${8 + Math.round(k * 4)}M39 37v-${4 + Math.round(k * 6)}`} stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
        </g>
      );
    case "people":
      return (
        <g fill="currentColor">
          {Array.from({ length: 5 }, (_, i) => {
            const a = (i / 5) * Math.PI * 2 + k;
            return <ellipse key={i} cx={32 + Math.cos(a) * 8} cy={32 + Math.sin(a) * 8} rx="6.5" ry="4" transform={`rotate(${(a * 180) / Math.PI} ${32 + Math.cos(a) * 8} ${32 + Math.sin(a) * 8})`} fillOpacity="0.8" />;
          })}
          <circle cx="32" cy="32" r="4" />
        </g>
      );
    case "support":
      return (
        <g>
          <path d="M17 22a6 6 0 0 1 6-6h18a6 6 0 0 1 6 6v12a6 6 0 0 1-6 6H29l-7 6v-6a6 6 0 0 1-5-6z" fill="currentColor" fillOpacity="0.9" />
          <path d="M25 28h.01M32 28h.01M39 28h.01" stroke="var(--av-to)" strokeWidth="3.4" strokeLinecap="round" />
        </g>
      );
    case "projects":
      return (
        <g fill="currentColor">
          <rect x="17" y="18" width={18 + k * 8} height="6" rx="3" />
          <rect x="23" y="29" width={16 + k * 6} height="6" rx="3" fillOpacity="0.8" />
          <rect x="29" y="40" width="16" height="6" rx="3" fillOpacity="0.6" />
        </g>
      );
    case "product":
      return (
        <g strokeLinejoin="round">
          <path d="M32 15l14 8-14 8-14-8z" fill="currentColor" />
          <path d="M18 23v16l14 8V31z" fill="currentColor" fillOpacity="0.65" />
          <path d="M46 23v16l-14 8V31z" fill="currentColor" fillOpacity="0.4" />
        </g>
      );
    case "executive":
      return <path d="M18 40l3-18 7 8 4-12 4 12 7-8 3 18z" fill="currentColor" fillOpacity="0.92" strokeLinejoin="round" />;
    case "operations":
      return (
        <g>
          <path
            d={Array.from({ length: 8 }, (_, i) => {
              const a1 = (i / 8) * Math.PI * 2;
              const a2 = a1 + Math.PI / 8;
              return `${i ? "L" : "M"}${32 + Math.cos(a1) * 15} ${32 + Math.sin(a1) * 15}L${32 + Math.cos(a2) * 11} ${32 + Math.sin(a2) * 11}`;
            }).join("") + "Z"}
            fill="currentColor"
            fillOpacity="0.9"
          />
          <circle cx="32" cy="32" r="4.5" fill="var(--av-to)" />
        </g>
      );
    default:
      return (
        <g>
          <ellipse cx="32" cy="32" rx="16" ry="7" fill="none" stroke="currentColor" strokeWidth="2" transform={`rotate(${-30 + k * 60} 32 32)`} opacity="0.85" />
          <circle cx="32" cy="32" r="6" fill="currentColor" />
          <circle cx={32 + 15 * Math.cos(k * 6)} cy={32 + 6 * Math.sin(k * 6)} r="2.4" fill="currentColor" />
        </g>
      );
  }
}

export function AiAvatar({
  seed,
  department,
  name,
  size = 40,
  active = false,
  className,
}: {
  /** Stable seed: the AI employee id (or name). */
  seed: string;
  department?: string | null;
  /** Accessible name; omit when a visible name is next to the avatar. */
  name?: string;
  size?: number;
  active?: boolean;
  className?: string;
}) {
  const p = avatarPalette(seed, department);
  const r = rng(hash(`${seed}:glyph`));
  const id = `av${hash(seed).toString(36)}`;
  const rot = Math.round((r() - 0.5) * 40);
  return (
    <span
      role={name ? "img" : undefined}
      aria-label={name}
      aria-hidden={name ? undefined : true}
      className={cn("relative inline-grid shrink-0 place-items-center", className)}
      style={{ width: size, height: size, ["--av-to" as string]: p.to }}
    >
      {active ? <span aria-hidden className="absolute -inset-1 rounded-[34%] border-2 animate-pulse" style={{ borderColor: p.from }} /> : null}
      <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden>
        <defs>
          <linearGradient id={`${id}g`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor={p.from} />
            <stop offset="1" stopColor={p.to} />
          </linearGradient>
          <radialGradient id={`${id}h`} cx="0.3" cy="0.2" r="0.8">
            <stop offset="0" stopColor="white" stopOpacity="0.45" />
            <stop offset="0.6" stopColor="white" stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect x="2" y="2" width="60" height="60" rx="20" fill={`url(#${id}g)`} />
        <rect x="2" y="2" width="60" height="60" rx="20" fill={`url(#${id}h)`} />
        <g style={{ color: p.ink }} transform={`rotate(${p.family === "sales" || p.family === "executive" ? 0 : rot} 32 32)`}>
          <Glyph fam={p.family} r={r} />
        </g>
        <rect x="2.5" y="2.5" width="59" height="59" rx="19.5" fill="none" stroke="white" strokeOpacity="0.25" />
      </svg>
    </span>
  );
}
