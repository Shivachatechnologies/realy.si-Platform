"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Bot, Cpu, Hourglass } from "lucide-react";
import { useT } from "@/i18n/client";
import { AiCoreStage } from "@/components/graphics/ai-core-stage";
import { ParticleField } from "@/components/graphics/particle-field";
import { DepthLayer, DepthScene } from "@/components/motion/parallax";
import { LiveDot } from "@/components/motion/live-dot";

/**
 * Command Center hero: the company's intelligence core (3D, reacting to the real AI workload) beside the editorial
 * headline and the objective command bar. `workload` null = the viewer may not see AI tasks (core idles, no chips).
 */
export function CommandHero({
  eyebrow,
  headline,
  sub,
  workload,
  locale,
  children,
}: {
  eyebrow: ReactNode;
  headline: ReactNode;
  sub: ReactNode;
  workload: { running: number; queued: number; employees: number } | null;
  locale: string;
  /** The objective bar. */
  children: ReactNode;
}) {
  const t = useT();
  const busy = workload ? workload.running + workload.queued : 0;
  // Normalise: 0 idle → ~1 at 12+ concurrent tasks.
  const activity = workload ? Math.min(1, (workload.running * 1.5 + workload.queued * 0.5) / 12) : 0;
  return (
    <section className="scene-bleed relative isolate -mt-5 overflow-hidden border-b lg:-mt-6">
      <div aria-hidden className="absolute inset-0 -z-10 opacity-70 mask-fade-b">
        <ParticleField density={0.5} intensity={0.25 + activity * 0.6} />
      </div>
      <DepthScene className="grid items-center gap-6 py-8 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] lg:py-12">
        <div className="relative z-10 grid min-w-0 gap-5">
          <div className="eyebrow-rule">{eyebrow}</div>
          <h1 className="font-display text-hero text-balance">{headline}</h1>
          <p className="max-w-xl text-[15px] leading-relaxed text-muted-foreground">{sub}</p>
          <div className="max-w-2xl">{children}</div>
        </div>
        <div className="relative mx-auto aspect-square w-full max-w-[30rem]">
          <DepthLayer depth={-10} className="absolute inset-0">
            <AiCoreStage activity={activity} nodes={workload?.employees || 6} className="size-full" />
          </DepthLayer>
          {workload ? (
            <>
              <DepthLayer depth={18} className="absolute start-0 top-[12%]">
                <Link href={`/${locale}/tasks`} className="panel-float flex items-center gap-2 px-3 py-2 text-xs transition-transform hover:-translate-y-0.5">
                  <Cpu className="size-3.5 text-primary" aria-hidden />
                  <LiveDot tone={workload.running ? "success" : "neutral"} />
                  <span className="numeral font-semibold">{workload.running}</span>
                  <span className="text-muted-foreground">{t("dna.command.running")}</span>
                </Link>
              </DepthLayer>
              <DepthLayer depth={26} className="absolute end-0 top-[46%]">
                <Link href={`/${locale}/workforce`} className="panel-float flex items-center gap-2 px-3 py-2 text-xs transition-transform hover:-translate-y-0.5">
                  <Bot className="size-3.5 text-primary" aria-hidden />
                  <span className="numeral font-semibold">{workload.employees}</span>
                  <span className="text-muted-foreground">{t("dna.command.employees")}</span>
                </Link>
              </DepthLayer>
              <DepthLayer depth={14} className="absolute start-[12%] bottom-[8%]">
                <Link href={`/${locale}/tasks`} className="panel-float flex items-center gap-2 px-3 py-2 text-xs transition-transform hover:-translate-y-0.5">
                  <Hourglass className="size-3.5 text-primary" aria-hidden />
                  <span className="numeral font-semibold">{workload.queued}</span>
                  <span className="text-muted-foreground">{t("dna.command.queued")}</span>
                </Link>
              </DepthLayer>
            </>
          ) : null}
          <p className="sr-only">{workload ? t("dna.command.coreStatus", { running: workload.running, queued: workload.queued, employees: workload.employees }) : null}</p>
          {busy === 0 && workload ? <p className="absolute inset-x-0 bottom-0 text-center text-xs text-muted-foreground">{t("dna.command.idle")}</p> : null}
        </div>
      </DepthScene>
    </section>
  );
}
