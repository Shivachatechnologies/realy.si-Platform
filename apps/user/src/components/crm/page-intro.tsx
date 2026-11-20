import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight, Compass, HelpCircle, Lightbulb, Sparkles, Target } from "lucide-react";
import { AiCore } from "@/components/motion/ai-core";
import { Button } from "@/components/ui/button";
import { getT } from "@/i18n/server";
import { cn } from "@/lib/utils";

/**
 * Plain-language header strip for a page: what this is, why it matters, what you can do here, and one primary next step.
 * Texts come from `${ns}.what|why|can|next` (all four required in every locale). `children` adds extra actions (e.g. a
 * "Help me do this" button). Shared by Sales OS and Finance OS pages.
 */
export async function PageIntro({ ns, href, tone = "sales", children, className }: { ns: string; href?: string; tone?: "sales" | "finance"; children?: ReactNode; className?: string }) {
  const t = await getT();
  const items = [
    { icon: Compass, label: t("crm.introLabels.what"), text: t(`${ns}.what`) },
    { icon: Target, label: t("crm.introLabels.why"), text: t(`${ns}.why`) },
    { icon: Lightbulb, label: t("crm.introLabels.can"), text: t(`${ns}.can`) },
  ];
  return (
    <section
      aria-label={t("crm.introLabels.aria")}
      className={cn(
        "reveal relative overflow-hidden rounded-lg border p-3 shadow-elev-1 sm:p-4",
        tone === "sales"
          ? "bg-[linear-gradient(120deg,color-mix(in_oklch,var(--primary)_7%,var(--surface)),var(--surface)_60%)]"
          : "bg-[linear-gradient(120deg,color-mix(in_oklch,var(--success)_8%,var(--surface)),var(--surface)_60%)]",
        className,
      )}
    >
      <div className="grid gap-3 lg:grid-cols-[repeat(3,minmax(0,1fr))_auto] lg:items-center">
        {items.map(({ icon: Icon, label, text }) => (
          <div key={label} className="flex min-w-0 items-start gap-2">
            <Icon aria-hidden className={cn("mt-0.5 size-4 shrink-0", tone === "sales" ? "text-primary" : "text-success")} />
            <p className="min-w-0 text-sm">
              <span className="block text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{label}</span>
              {text}
            </p>
          </div>
        ))}
        <div className="flex flex-wrap items-center gap-2 lg:justify-end">
          {children}
          {href ? (
            <Button asChild size="sm" variant={tone === "sales" ? "gradient" : "default"}>
              <Link href={href}>
                {t(`${ns}.next`)}
                <ArrowRight aria-hidden className="rtl:-scale-x-100" />
              </Link>
            </Button>
          ) : (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <HelpCircle aria-hidden className="size-3.5" />
              {t(`${ns}.next`)}
            </span>
          )}
        </div>
      </div>
    </section>
  );
}

/** "What's this?" — a jargon word with its plain-language explanation on hover/focus (and for screen readers). */
export function Term({ word, explain }: { word: ReactNode; explain: string }) {
  return (
    <span className="group relative inline-flex items-baseline">
      <span tabIndex={0} className="cursor-help border-b border-dotted border-current outline-none">
        {word}
      </span>
      <span role="tooltip" className="pointer-events-none absolute start-0 top-full z-20 mt-1 hidden w-64 rounded-md border bg-surface p-2 text-xs font-normal text-foreground shadow-elev-2 group-focus-within:block group-hover:block">
        {explain}
      </span>
      <span className="sr-only">({explain})</span>
    </span>
  );
}

/**
 * Smart empty state: explains what belongs here, offers to create the first item, and a "Let AI do it" path.
 * Texts: `${ns}.title|text|primary|ai`.
 */
export async function SmartEmpty({ ns, primaryHref, aiHref }: { ns: string; primaryHref: string; aiHref?: string }) {
  const t = await getT();
  return (
    <div className="grid place-items-center gap-3 px-4 py-10 text-center">
      <AiCore className="size-24" />
      <div className="grid max-w-md gap-1">
        <p className="text-base font-semibold">{t(`${ns}.title`)}</p>
        <p className="text-sm text-muted-foreground">{t(`${ns}.text`)}</p>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        <Button asChild size="sm" variant="default">
          <Link href={primaryHref}>{t(`${ns}.primary`)}</Link>
        </Button>
        {aiHref ? (
          <Button asChild size="sm" variant="gradient">
            <Link href={aiHref}>
              <Sparkles aria-hidden />
              {t(`${ns}.ai`)}
            </Link>
          </Button>
        ) : null}
      </div>
    </div>
  );
}
