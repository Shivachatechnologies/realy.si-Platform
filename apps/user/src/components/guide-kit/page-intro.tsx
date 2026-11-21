import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight, Compass, Lightbulb, Wand2 } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Short header strip every page in a guided area shows: what this is, why it matters, what you can do here and the one
 * thing to do next (a single primary action). Plain words; works in Server Components.
 */
export function PageIntro({
  what,
  why,
  can,
  next,
  labels,
  accent = "primary",
  extra,
  className,
}: {
  what: ReactNode;
  why: ReactNode;
  can: ReactNode;
  /** The one primary action: a link or any element (e.g. a client button). */
  next?: { label: string; href: string } | ReactNode;
  labels: { what: string; why: string; can: string; next: string };
  accent?: "primary" | "success" | "info" | "warning";
  extra?: ReactNode;
  className?: string;
}) {
  const tone = { primary: "text-primary", success: "text-success", info: "text-info", warning: "text-warning" }[accent];
  const cells: [string, ReactNode, ReactNode][] = [
    [labels.what, what, <Compass key="w" aria-hidden />],
    [labels.why, why, <Lightbulb key="y" aria-hidden />],
    [labels.can, can, <Wand2 key="c" aria-hidden />],
  ];
  const isLink = (v: unknown): v is { label: string; href: string } => !!v && typeof v === "object" && "href" in (v as object) && "label" in (v as object);
  return (
    <section className={cn("glass reveal relative overflow-hidden rounded-lg border shadow-elev-1", className)} aria-label={labels.what}>
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px bg-brand-gradient opacity-60" />
      <div className="grid gap-3 p-3 sm:p-4 lg:grid-cols-[repeat(3,minmax(0,1fr))_auto] lg:items-center">
        {cells.map(([label, text, icon]) => (
          <div key={label} className="flex min-w-0 items-start gap-2">
            <span className={cn("mt-0.5 grid size-6 shrink-0 place-items-center rounded-md bg-accent [&_svg]:size-3.5", tone)}>{icon}</span>
            <div className="min-w-0">
              <p className="text-[11px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">{label}</p>
              <p className="text-sm text-foreground/90">{text}</p>
            </div>
          </div>
        ))}
        {next ? (
          <div className="flex flex-col items-start gap-1 lg:items-end">
            <p className="text-[11px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">{labels.next}</p>
            {isLink(next) ? (
              <Link href={next.href} className={cn(buttonVariants({ size: "sm" }), "gap-1.5")}>
                {next.label}
                <ArrowRight className="rtl:-scale-x-100" aria-hidden />
              </Link>
            ) : (
              next
            )}
          </div>
        ) : null}
      </div>
      {extra ? <div className="border-t px-3 py-2 sm:px-4">{extra}</div> : null}
    </section>
  );
}
