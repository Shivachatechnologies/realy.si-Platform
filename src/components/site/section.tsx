import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Editorial section heading for the public site: eyebrow rule, serif display title, quiet lede. */
export function SiteHeading({ eyebrow, title, lede, align = "start", as: Tag = "h2", className }: { eyebrow?: ReactNode; title: ReactNode; lede?: ReactNode; align?: "start" | "center"; as?: "h1" | "h2"; className?: string }) {
  return (
    <div className={cn("grid gap-4", align === "center" && "justify-items-center text-center", className)}>
      {eyebrow ? <p className="eyebrow-rule">{eyebrow}</p> : null}
      <Tag className={cn("max-w-3xl font-display text-balance break-words", Tag === "h1" ? "text-hero" : "text-display-xl")}>{title}</Tag>
      {lede ? <p className="max-w-2xl text-[15.5px] leading-relaxed text-pretty text-muted-foreground sm:text-[16.5px]">{lede}</p> : null}
    </div>
  );
}

/** Page container with consistent gutters (16px on phones). */
export function SiteContainer({ children, className, wide = false }: { children: ReactNode; className?: string; wide?: boolean }) {
  return <div className={cn("mx-auto w-full px-4 sm:px-6", wide ? "max-w-7xl" : "max-w-6xl", className)}>{children}</div>;
}
