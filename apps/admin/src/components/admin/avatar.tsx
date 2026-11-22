import { cn } from "@/lib/utils";

/** Initials avatar with a stable hue per name. */
export function Avatar({ name, size = "md", square }: { name: string; size?: "sm" | "md" | "lg"; square?: boolean }) {
  const initials =
    name
      .split(/[\s@._-]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]!.toUpperCase())
      .join("") || "?";
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return (
    <span
      aria-hidden
      className={cn(
        "grid shrink-0 place-items-center font-semibold text-white shadow-elev-1",
        square ? "rounded-md" : "rounded-full",
        size === "sm" ? "size-7 text-[11px]" : size === "lg" ? "size-12 text-base" : "size-9 text-xs",
      )}
      style={{ background: `linear-gradient(135deg, oklch(0.62 0.13 ${h}), oklch(0.5 0.12 ${(h + 40) % 360}))` }}
    >
      {initials}
    </span>
  );
}
