import { cn } from "@/lib/utils";

/** FNV-1a hash of the id → stable pseudo-random numbers for the avatar. */
function hash(id: string) {
  let h = 0x811c9dc5;
  for (const c of id) {
    h ^= c.charCodeAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/**
 * Generated avatar for an AI employee: a deterministic SVG (two-hue gradient, a shape and an orbit ring derived from
 * the id) with the initials on top. The same id always renders the same face; paused employees are greyed and a
 * running task spins the orbit ring (static under reduced motion).
 */
export function AiAvatar({ id, initials, paused, working, size = "md" }: { id: string; initials: string; paused?: boolean; working?: boolean; size?: "sm" | "md" | "lg" }) {
  const h = hash(id);
  const hue1 = h % 360;
  const hue2 = (hue1 + 40 + ((h >> 9) % 80)) % 360;
  const shape = (h >> 17) % 4;
  const rot = (h >> 4) % 360;
  const gid = `av-${id.replace(/[^a-z0-9]/gi, "").slice(-16)}`;
  const px = size === "sm" ? 28 : size === "lg" ? 48 : 36;
  return (
    <span aria-hidden className={cn("relative inline-grid shrink-0 place-items-center overflow-hidden rounded-full", paused && "opacity-50 grayscale")} style={{ width: px, height: px }}>
      <svg viewBox="0 0 40 40" width={px} height={px} className="absolute inset-0">
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={`oklch(0.68 0.16 ${hue1})`} />
            <stop offset="100%" stopColor={`oklch(0.5 0.18 ${hue2})`} />
          </linearGradient>
        </defs>
        <rect width="40" height="40" fill={`url(#${gid})`} />
        <g transform={`rotate(${rot} 20 20)`} fill="white" fillOpacity="0.2">
          {shape === 0 ? <circle cx="28" cy="12" r="10" /> : null}
          {shape === 1 ? <polygon points="20,2 36,30 4,30" /> : null}
          {shape === 2 ? <rect x="18" y="-4" width="22" height="22" rx="4" /> : null}
          {shape === 3 ? <path d="M0 26 Q20 8 40 26 L40 40 L0 40Z" /> : null}
        </g>
        <circle cx="20" cy="20" r="15" fill="none" stroke="white" strokeOpacity={working ? 0.85 : 0.3} strokeWidth={working ? 1.6 : 1} strokeDasharray={`${2 + (h % 5)} ${3 + ((h >> 3) % 4)}`} className={working ? "origin-center animate-spin [animation-duration:3s] motion-reduce:animate-none" : undefined} style={{ transformBox: "fill-box" }} />
      </svg>
      <span className={cn("relative font-semibold text-white drop-shadow-sm", size === "sm" ? "text-[11px]" : size === "lg" ? "text-base" : "text-xs")}>{initials}</span>
    </span>
  );
}
