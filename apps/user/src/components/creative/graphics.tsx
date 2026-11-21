import { cn } from "@/lib/utils";

/** Editorial header illustration for the studio: a film strip running into a storyboard frame (decorative). */
export function StudioReel({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 280 180" className={cn("text-primary", className)} role="presentation" aria-hidden>
      <defs>
        <linearGradient id="studio-reel-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="currentColor" stopOpacity="0.85" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0.25" />
        </linearGradient>
      </defs>
      <g fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
        <rect x="18" y="36" width="150" height="62" rx="6" opacity="0.55" />
        {[0, 1, 2, 3, 4].map((i) => (
          <g key={i}>
            <rect x={26 + i * 28} y="46" width="22" height="42" rx="2" fill="url(#studio-reel-g)" opacity={0.25 + i * 0.14} stroke="none" />
            <rect x={28 + i * 28} y="39" width="4" height="3" rx="0.6" opacity="0.6" />
            <rect x={28 + i * 28} y="92" width="4" height="3" rx="0.6" opacity="0.6" />
          </g>
        ))}
        <path d="M168 67 C 190 67, 196 110, 214 110" strokeDasharray="3 4" opacity="0.6" />
        <rect x="182" y="96" width="82" height="62" rx="8" />
        <path d="M194 146 l14 -18 l10 12 l8 -8 l16 14" opacity="0.8" />
        <circle cx="244" cy="114" r="5" opacity="0.8" />
        <path d="M40 132 h70 M40 142 h52 M40 152 h62" opacity="0.45" />
        <circle cx="28" cy="142" r="6" opacity="0.6" />
        <path d="M26 139 v6 l5 -3 z" fill="currentColor" stroke="none" opacity="0.8" />
      </g>
    </svg>
  );
}

/** Thin progress rail of a pipeline: one segment per step, colored by state. */
export function PipelineRail({ steps, label }: { steps: { key: string; status: string }[]; label: string }) {
  const color: Record<string, string> = {
    SUCCEEDED: "bg-success",
    SKIPPED: "bg-muted-foreground/30",
    RUNNING: "bg-primary animate-pulse motion-reduce:animate-none",
    WAITING_PROVIDER: "bg-info animate-pulse motion-reduce:animate-none",
    NEEDS_INPUT: "bg-warning",
    BLOCKED: "bg-warning",
    FAILED: "bg-danger",
    PENDING: "bg-muted",
  };
  return (
    <div className="flex gap-0.5" role="img" aria-label={label}>
      {steps.map((s) => (
        <span key={s.key} className={cn("h-1.5 flex-1 rounded-full", color[s.status] ?? "bg-muted")} />
      ))}
    </div>
  );
}
