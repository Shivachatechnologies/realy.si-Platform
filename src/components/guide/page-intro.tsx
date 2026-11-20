"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight, Compass, HelpCircle, Lightbulb, ListChecks } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/client";
import { cn } from "@/lib/utils";
import { moduleStyle } from "./module-style";

/**
 * Header strip every screen can show: What is this? Why it matters? What you can do here? What to do next (one
 * primary button). Plain props, so it works from Server Components:
 *
 *   <PageIntro module="finance" what={t("finance.intro.what")} why={t("finance.intro.why")} can={t("finance.intro.can")}
 *     next={{ label: t("finance.intro.next"), href: `/${locale}/finance/invoices/new` }} />
 */
export function PageIntro({
  what,
  why,
  can,
  next,
  module,
  className,
  children,
}: {
  what: ReactNode;
  why: ReactNode;
  can: ReactNode;
  next?: { label: string; href: string };
  module?: string;
  className?: string;
  /** Optional extra content under the strip (e.g. a jargon tooltip). */
  children?: ReactNode;
}) {
  const t = useT();
  const style = moduleStyle(module);
  const items = [
    { icon: HelpCircle, label: t("guide.labels.what"), body: what },
    { icon: Lightbulb, label: t("guide.labels.why"), body: why },
    { icon: ListChecks, label: t("guide.labels.can"), body: can },
  ];
  return (
    <section aria-label={t("guide.intro.label")} className={cn("glass relative overflow-hidden rounded-xl border p-4 shadow-elev-1", className)}>
      <div aria-hidden className={cn("absolute inset-y-0 start-0 w-1 bg-gradient-to-b", style.ring)} />
      <div className="grid gap-4 lg:grid-cols-[1fr_1fr_1fr_auto] lg:items-center">
        {items.map(({ icon: I, label, body }, i) => (
          <div key={i} className="flex min-w-0 items-start gap-2.5 animate-fade-up" style={{ animationDelay: `${i * 60}ms` }}>
            <I className={cn("mt-0.5 size-4 shrink-0", style.tone)} aria-hidden />
            <div className="min-w-0">
              <p className="text-[11px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">{label}</p>
              <div className="text-sm">{body}</div>
            </div>
          </div>
        ))}
        {next ? (
          <div className="flex items-center gap-2 animate-fade-up lg:justify-end" style={{ animationDelay: "180ms" }}>
            <Compass className="size-4 text-primary lg:hidden" aria-hidden />
            <Button asChild variant="gradient">
              <Link href={next.href}>
                <span className="sr-only">{t("guide.labels.next")}: </span>
                {next.label}
                <ArrowRight aria-hidden className="rtl:rotate-180" />
              </Link>
            </Button>
          </div>
        ) : null}
      </div>
      {children}
    </section>
  );
}
