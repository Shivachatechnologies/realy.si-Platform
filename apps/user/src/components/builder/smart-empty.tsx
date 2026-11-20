import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight, Sparkles } from "lucide-react";

/**
 * Smart empty state for builder and product pages: what this page is for, the three things that happen when the founder
 * starts, and one "Help me do this" action that opens the guided flow. Server-safe (no client code).
 */
export function SmartEmpty({ icon, title, hint, steps, help, href, secondary }: { icon?: ReactNode; title: string; hint: string; steps: string[]; help: string; href?: string | null; secondary?: ReactNode }) {
  return (
    <div className="relative isolate grid justify-items-center gap-4 overflow-hidden px-4 py-10 text-center sm:px-8">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_50%_0%,var(--glow),transparent_65%)] opacity-40" />
      <span className="grid size-14 place-items-center rounded-2xl bg-primary/10 text-primary shadow-glow [&_svg]:size-7">{icon ?? <Sparkles aria-hidden />}</span>
      <div className="grid max-w-lg gap-1.5">
        <p className="font-display text-xl text-balance">{title}</p>
        <p className="text-sm text-pretty text-muted-foreground">{hint}</p>
      </div>
      <ol className="grid w-full max-w-2xl gap-2 text-start sm:grid-cols-3">
        {steps.map((s, i) => (
          <li key={s} className="flex items-start gap-2 rounded-xl border bg-surface/80 px-3 py-2.5 text-xs text-pretty">
            <span className="grid size-5 shrink-0 place-items-center rounded-full bg-primary/15 text-[11px] font-semibold text-primary tabular-nums">{i + 1}</span>
            <span>{s}</span>
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap items-center justify-center gap-2">
        {href ? (
          <Link href={href} className="press inline-flex h-10 items-center gap-2 rounded-xl bg-brand-gradient px-5 text-sm font-medium text-primary-foreground shadow-glow hover:brightness-110">
            <Sparkles className="size-4" aria-hidden />
            {help}
            <ArrowRight className="size-4 rtl:-scale-x-100" aria-hidden />
          </Link>
        ) : null}
        {secondary}
      </div>
    </div>
  );
}
