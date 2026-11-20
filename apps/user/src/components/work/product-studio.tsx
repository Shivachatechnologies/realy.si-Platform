import Link from "next/link";
import type { ReactNode } from "react";
import { CheckCircle2, Circle, Compass, Hammer, Lightbulb, PenTool, Rocket, Search } from "lucide-react";
import { Aurora } from "@/components/motion/aurora";
import { AnimatedProgress } from "@/components/motion/animated-progress";
import { RevealGroup } from "@/components/motion/reveal";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import type { Translate } from "@/i18n/translate";
import { cn } from "@/lib/utils";
import { PRODUCT_STAGES } from "@/server/modules/work/product-constants";
import type { launchReadiness, productJourney } from "@/server/modules/work/product-journey";
import { AiButton } from "./actions";
import { TASK_TONE } from "./ui";

/** Product Studio: visual identity and guided-journey pieces of the product area (server components). */

const STEP_ICON = { idea: Lightbulb, research: Search, plan: Compass, design: PenTool, build: Hammer, launch: Rocket } as const;

/** Hero band with the studio's aurora identity. */
export function StudioHero({ title, description, eyebrow, actions, children }: { title: ReactNode; description?: ReactNode; eyebrow?: ReactNode; actions?: ReactNode; children?: ReactNode }) {
  return (
    <section className="relative isolate overflow-hidden rounded-xl border-gradient p-5 shadow-glow sm:p-6 [--gradient-fill:linear-gradient(135deg,color-mix(in_oklch,var(--primary)_10%,var(--surface)),var(--surface)_60%)]">
      <Aurora className="!absolute -z-10 opacity-70" />
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="grid max-w-2xl gap-1">
          {eyebrow ? <div className="text-[11px] font-semibold tracking-[0.08em] text-primary uppercase">{eyebrow}</div> : null}
          <h1 className="text-gradient text-2xl font-semibold tracking-[-0.02em] sm:text-3xl">{title}</h1>
          {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {children ? <div className="mt-4">{children}</div> : null}
    </section>
  );
}

/** "What is this / why it matters / what to do next" strip with one primary action. */
export function HelpStrip({ t, area, action }: { t: Translate; area: string; action?: ReactNode }) {
  return (
    <Card variant="glass" className="grid gap-3 p-4 text-sm sm:grid-cols-[repeat(3,minmax(0,1fr))_auto] sm:items-center">
      <p>
        <span className="block text-[11px] font-semibold tracking-wide text-primary uppercase">{t("product.help.whatLabel")}</span>
        {t(`product.help.${area}.what`)}
      </p>
      <p>
        <span className="block text-[11px] font-semibold tracking-wide text-primary uppercase">{t("product.help.whyLabel")}</span>
        {t(`product.help.${area}.why`)}
      </p>
      <p>
        <span className="block text-[11px] font-semibold tracking-wide text-primary uppercase">{t("product.help.nextLabel")}</span>
        {t(`product.help.${area}.next`)}
      </p>
      {action ? <div className="flex flex-wrap gap-2">{action}</div> : null}
    </Card>
  );
}

/** Lifecycle rail: the 13 stages as an SVG track filled up to the current stage (from the product's real stage). */
export function LifecycleRail({ t, stage, compact = false }: { t: Translate; stage: string; compact?: boolean }) {
  const n = PRODUCT_STAGES.length;
  const current = Math.max(0, PRODUCT_STAGES.indexOf(stage as (typeof PRODUCT_STAGES)[number]));
  const w = 1000;
  const x = (i: number) => 20 + (i * (w - 40)) / (n - 1);
  const h = compact ? 28 : 64;
  const y = 14;
  return (
    <figure className="grid gap-1" aria-label={t("product.railLabel", { stage: t(`product.stages.${stage}`), n: current + 1, total: n })} role="img">
      <svg viewBox={`0 0 ${w} ${h}`} className="h-auto w-full overflow-visible rtl:-scale-x-100" aria-hidden>
        <defs>
          <linearGradient id="rail-fill" x1="0" x2="1">
            <stop offset="0" stopColor="var(--primary)" />
            <stop offset="1" stopColor="var(--info, var(--primary))" />
          </linearGradient>
        </defs>
        <line x1={x(0)} x2={x(n - 1)} y1={y} y2={y} stroke="var(--muted)" strokeWidth={6} strokeLinecap="round" />
        <line
          x1={x(0)}
          x2={x(current)}
          y1={y}
          y2={y}
          stroke="url(#rail-fill)"
          strokeWidth={6}
          strokeLinecap="round"
          strokeDasharray={w}
          strokeDashoffset={0}
          className="motion-safe:animate-[rail-draw_1.2s_cubic-bezier(0.16,1,0.3,1)_backwards]"
          style={{ ["--rail-len" as string]: `${x(current) - x(0)}` }}
        />
        {PRODUCT_STAGES.map((s, i) => (
          <g key={s}>
            {i === current ? <circle cx={x(i)} cy={y} r={12} fill="var(--primary)" opacity={0.18} className="motion-safe:animate-pulse" /> : null}
            <circle cx={x(i)} cy={y} r={i === current ? 8 : 5.5} fill={i <= current ? "var(--primary)" : "var(--surface)"} stroke={i <= current ? "var(--primary)" : "var(--border)"} strokeWidth={2} />
          </g>
        ))}
      </svg>
      {!compact ? (
        <ol className="grid text-[10px] leading-tight text-muted-foreground" style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}>
          {PRODUCT_STAGES.map((s, i) => (
            <li key={s} className={cn("px-0.5 text-center", i === current && "font-semibold text-primary", i < current && "text-foreground")}>
              <span className="hidden md:inline">{t(`product.stages.${s}`)}</span>
              <span className="md:hidden">{i + 1}</span>
            </li>
          ))}
        </ol>
      ) : null}
      <style>{"@keyframes rail-draw{from{stroke-dashoffset:var(--rail-len)}to{stroke-dashoffset:0}}"}</style>
    </figure>
  );
}

type Journey = Awaited<ReturnType<typeof productJourney>>;

/** The six plain-language journey steps with real progress, one primary action and "Help me do this" each. */
export function JourneyMap({ t, locale, base, productId, journey, canEdit, canAi }: { t: Translate; locale: string; base: string; productId: string; journey: Journey; canEdit: boolean; canAi: boolean }) {
  const ws = `/${locale}/product/${productId}`;
  const primary: Record<string, string> = {
    idea: ws,
    research: `${ws}/research`,
    plan: `${ws}/documents/prd`,
    design: `${ws}/documents/design_brief`,
    build: `${ws}/backlog`,
    launch: `${ws}/releases`,
  };
  const aiUrl = (s: Journey["steps"][number]) =>
    s.ai.kind === "plan" ? `${base}/product/products/${productId}/plan` : s.ai.kind === "apply" ? `${base}/product/products/${productId}/plan/apply` : `${base}/product/products/${productId}/docs/${s.ai.doc.toLowerCase()}/ai`;
  return (
    <RevealGroup as="ol" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {journey.steps.map((s, i) => {
        const Icon = STEP_ICON[s.key];
        return (
          <li key={s.key} className="reveal">
            <Card variant={s.status === "current" ? "highlight" : s.status === "done" ? "elevated" : "default"} className="grid h-full content-start gap-3 p-4">
              <div className="flex items-center gap-2">
                <span className={cn("grid size-9 place-items-center rounded-lg border", s.status === "current" ? "border-primary bg-primary/10 text-primary" : s.status === "done" ? "border-success/40 bg-success/8 text-success" : "text-muted-foreground")} aria-hidden>
                  <Icon className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] text-muted-foreground">{t("product.journey.stepN", { n: i + 1 })}</p>
                  <h3 className="font-semibold">{t(`product.journey.${s.key}.title`)}</h3>
                </div>
                <Badge tone={s.status === "done" ? "success" : s.status === "current" ? "accent" : "neutral"} pulse={s.status === "current"}>
                  {t(`product.journey.status.${s.status}`)}
                </Badge>
              </div>
              <dl className="grid gap-1.5 text-sm">
                <div>
                  <dt className="text-[11px] font-medium text-muted-foreground">{t("product.journey.means")}</dt>
                  <dd>{t(`product.journey.${s.key}.means`)}</dd>
                </div>
                <div>
                  <dt className="text-[11px] font-medium text-muted-foreground">{t("product.journey.why")}</dt>
                  <dd>{t(`product.journey.${s.key}.why`)}</dd>
                </div>
                <div>
                  <dt className="text-[11px] font-medium text-muted-foreground">{t("product.journey.aiDoes")}</dt>
                  <dd>{t(`product.journey.${s.key}.ai`)}</dd>
                </div>
              </dl>
              <AnimatedProgress value={s.status === "done" ? 100 : s.progress} label={t("product.journey.progressLabel", { step: t(`product.journey.${s.key}.title`) })} tone={s.status === "done" ? "success" : "primary"} size="sm" />
              <ul className="grid gap-0.5 text-xs">
                {s.checks.map((c) => (
                  <li key={c.key} className={cn("flex items-center gap-1.5", c.done ? "text-foreground" : "text-muted-foreground")}>
                    {c.done ? <CheckCircle2 className="size-3.5 text-success" aria-hidden /> : <Circle className="size-3.5" aria-hidden />}
                    <span>{t(`product.journey.checks.${c.key}`)}</span>
                    <span className="sr-only">{c.done ? t("product.journey.done") : t("product.journey.todo")}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-auto flex flex-wrap items-center gap-2">
                <Link href={primary[s.key]!} className="press inline-flex h-8 items-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:opacity-90">
                  {t(`product.journey.${s.key}.action`)}
                </Link>
                {canEdit && canAi && s.status !== "done" ? <AiButton url={aiUrl(s)} label={t("product.journey.helpMe")} /> : null}
                {s.aiTask ? (
                  <Link href={`/${locale}/tasks/${s.aiTask.id}`} className="inline-flex items-center gap-1 text-xs hover:underline">
                    <Badge tone={TASK_TONE[s.aiTask.status]} pulse={s.aiTask.status === "RUNNING" || s.aiTask.status === "QUEUED"}>
                      {t(`agentTasks.status.${s.aiTask.status}`)}
                    </Badge>
                  </Link>
                ) : null}
              </div>
            </Card>
          </li>
        );
      })}
    </RevealGroup>
  );
}

type Readiness = Awaited<ReturnType<typeof launchReadiness>>;

/** Launch readiness donut + checklist (real data). */
export function ReadinessGauge({ t, readiness }: { t: Translate; readiness: Readiness }) {
  const r = 52;
  const c = 2 * Math.PI * r;
  const tone = readiness.score >= 80 ? "var(--success)" : readiness.score >= 50 ? "var(--warning)" : "var(--danger)";
  return (
    <div className="grid gap-4 sm:grid-cols-[9rem_minmax(0,1fr)] sm:items-center">
      <figure role="img" aria-label={t("product.readiness.scoreLabel", { score: readiness.score })} className="relative mx-auto size-36">
        <svg viewBox="0 0 120 120" className="size-full -rotate-90" aria-hidden>
          <circle cx={60} cy={60} r={r} fill="none" stroke="var(--muted)" strokeWidth={10} />
          <circle
            cx={60}
            cy={60}
            r={r}
            fill="none"
            stroke={tone}
            strokeWidth={10}
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={c * (1 - readiness.score / 100)}
            className="motion-safe:transition-[stroke-dashoffset] motion-safe:duration-1000"
          />
        </svg>
        <span className="absolute inset-0 grid place-items-center text-center">
          <span>
            <span className="block text-2xl font-semibold tabular-nums">{readiness.score}%</span>
            <span className="block text-[10px] text-muted-foreground">{t("product.readiness.ready")}</span>
          </span>
        </span>
      </figure>
      <ul className="grid gap-1 text-xs sm:grid-cols-2">
        {readiness.items.map((i) => (
          <li key={i.key} className={cn("flex items-center gap-1.5", !i.done && "text-muted-foreground")}>
            {i.done ? <CheckCircle2 className="size-3.5 shrink-0 text-success" aria-hidden /> : <Circle className="size-3.5 shrink-0" aria-hidden />}
            {t(`product.readiness.items.${i.key}`)}
            <span className="sr-only">{i.done ? t("product.journey.done") : t("product.journey.todo")}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const STATUS_COLOR = { PROPOSED: "var(--muted-foreground)", PLANNED: "var(--info, var(--primary))", IN_PROGRESS: "var(--primary)", SHIPPED: "var(--success)" } as const;

/** Roadmap chart: features per quarter, stacked by status (SVG, real data). */
export function RoadmapChart({ t, quarters, features }: { t: Translate; quarters: string[]; features: { quarter: string | null; status: string }[] }) {
  const cols = [...quarters, ""];
  const statuses = Object.keys(STATUS_COLOR) as (keyof typeof STATUS_COLOR)[];
  const data = cols.map((q) => ({ q, counts: statuses.map((s) => features.filter((f) => (f.quarter ?? "") === q && f.status === s).length) }));
  const max = Math.max(1, ...data.map((d) => d.counts.reduce((a, b) => a + b, 0)));
  const W = 600;
  const H = 160;
  const bw = W / cols.length;
  const summary = data.map((d) => `${d.q || t("work.product.unscheduled")}: ${d.counts.reduce((a, b) => a + b, 0)}`).join(", ");
  return (
    <figure className="grid gap-2" role="img" aria-label={t("product.roadmapChart.label", { summary })}>
      <svg viewBox={`0 0 ${W} ${H + 24}`} className="h-auto w-full" aria-hidden>
        {data.map((d, i) => {
          let yAcc = H;
          return (
            <g key={d.q || "none"}>
              {d.counts.map((n, si) => {
                if (!n) return null;
                const h = (n / max) * (H - 10);
                yAcc -= h;
                return <rect key={si} x={i * bw + bw * 0.2} y={yAcc} width={bw * 0.6} height={h} rx={3} fill={STATUS_COLOR[statuses[si]!]} className="motion-safe:animate-fade-up" />;
              })}
              <text x={i * bw + bw / 2} y={H + 16} textAnchor="middle" fontSize={11} fill="var(--muted-foreground)">
                {d.q || t("work.product.unscheduled")}
              </text>
              <text x={i * bw + bw / 2} y={yAcc - 4} textAnchor="middle" fontSize={11} fill="var(--foreground)">
                {d.counts.reduce((a, b) => a + b, 0) || ""}
              </text>
            </g>
          );
        })}
      </svg>
      <figcaption className="flex flex-wrap gap-3 text-xs text-muted-foreground">
        {statuses.map((s) => (
          <span key={s} className="inline-flex items-center gap-1">
            <span className="size-2.5 rounded-sm" style={{ background: STATUS_COLOR[s] }} aria-hidden />
            {t(`work.itemStatus.${s}`)}
          </span>
        ))}
      </figcaption>
    </figure>
  );
}
