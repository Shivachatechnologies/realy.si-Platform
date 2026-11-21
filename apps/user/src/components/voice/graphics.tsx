import { cn } from "@/lib/utils";

/** Hand-drawn phone with sound waves (the phone team's header art). Pure SVG; waves pulse only without reduced motion. */
export function PhoneWaves({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 240 180" role="img" aria-hidden className={cn("text-primary", className)}>
      <defs>
        <linearGradient id="vw-g" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stopColor="var(--primary)" stopOpacity="0.9" />
          <stop offset="1" stopColor="var(--primary-2, var(--primary))" stopOpacity="0.7" />
        </linearGradient>
      </defs>
      <circle cx="120" cy="92" r="70" fill="var(--primary)" opacity="0.06" />
      <g fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="2.5">
        <path className="motion-safe:animate-pulse" d="M150 62c10 8 15 19 15 30s-5 22-15 30" opacity="0.55" />
        <path className="motion-safe:animate-pulse [animation-delay:300ms]" d="M164 48c14 12 22 28 22 44s-8 32-22 44" opacity="0.35" />
        <path className="motion-safe:animate-pulse [animation-delay:600ms]" d="M178 34c18 16 28 36 28 58s-10 42-28 58" opacity="0.2" />
      </g>
      <rect x="78" y="40" width="58" height="104" rx="12" fill="url(#vw-g)" />
      <rect x="85" y="52" width="44" height="74" rx="5" fill="var(--surface, white)" opacity="0.92" />
      <circle cx="107" cy="134" r="4" fill="var(--surface, white)" opacity="0.9" />
      <g fill="currentColor" opacity="0.75">
        <rect x="92" y="84" width="3" height="10" rx="1.5" />
        <rect x="98" y="78" width="3" height="22" rx="1.5" />
        <rect x="104" y="72" width="3" height="34" rx="1.5" />
        <rect x="110" y="80" width="3" height="18" rx="1.5" />
        <rect x="116" y="76" width="3" height="26" rx="1.5" />
        <rect x="122" y="84" width="3" height="10" rx="1.5" />
      </g>
      <text x="107" y="66" textAnchor="middle" fontSize="8" fontWeight="600" fill="currentColor">AI</text>
    </svg>
  );
}
