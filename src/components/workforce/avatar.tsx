import { cn } from "@/lib/utils";

const TONES = ["bg-sky-500/15 text-sky-700 dark:text-sky-300", "bg-violet-500/15 text-violet-700 dark:text-violet-300", "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300", "bg-amber-500/15 text-amber-700 dark:text-amber-300", "bg-rose-500/15 text-rose-700 dark:text-rose-300", "bg-teal-500/15 text-teal-700 dark:text-teal-300"];

/** Initials avatar for an AI employee (colour derived from the id). */
export function AiAvatar({ id, initials, paused, size = "md" }: { id: string; initials: string; paused?: boolean; size?: "sm" | "md" | "lg" }) {
  const tone = TONES[[...id].reduce((s, c) => s + c.charCodeAt(0), 0) % TONES.length];
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full font-semibold",
        tone,
        paused && "opacity-50 grayscale",
        size === "sm" ? "size-7 text-[11px]" : size === "lg" ? "size-12 text-base" : "size-9 text-xs",
      )}
    >
      {initials}
    </span>
  );
}
