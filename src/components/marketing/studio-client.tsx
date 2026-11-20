"use client";

import { useState, type ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import { LifeBuoy, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormError } from "@/components/form-error";
import { useT } from "@/i18n/client";
import { api } from "@/lib/api-client";
import { useAction } from "./ui";

/** "Help me do this": creates an AI task with the page context (shown in the help panel with live status). */
export function HelpButton({ base, page, context, label }: { base: string; page: string; context?: string; label?: string }) {
  const t = useT();
  const [q, setQ] = useState("");
  const { busy, error, run } = useAction();
  return (
    <form
      className="grid gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        void run(() => api(`${base}/help`, { body: { page, question: q.trim() || undefined, context } }), () => setQ(""));
      }}
    >
      <div className="flex flex-wrap gap-2">
        <Input className="min-w-0 flex-1" value={q} maxLength={1000} placeholder={t("marketing.studio.help.placeholder")} aria-label={t("marketing.studio.help.placeholder")} onChange={(e) => setQ(e.target.value)} />
        <Button type="submit" size="sm" variant="secondary" disabled={busy}>
          <LifeBuoy aria-hidden />
          {label ?? t("marketing.studio.help.button")}
        </Button>
      </div>
      <FormError error={error} />
    </form>
  );
}

/** Generic JSON POST/PATCH/PUT form: renders children inputs (name=…) and sends their values. */
export function JsonForm({
  path,
  method = "POST",
  submit,
  children,
  transform,
  className,
  reset = true,
  icon,
}: {
  path: string;
  method?: "POST" | "PATCH" | "PUT";
  submit: ReactNode;
  children: ReactNode;
  transform?: (v: Record<string, string>) => unknown;
  className?: string;
  reset?: boolean;
  icon?: ReactNode;
}) {
  const { busy, error, run } = useAction();
  return (
    <form
      className={className ?? "grid gap-3"}
      onSubmit={(e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const values = Object.fromEntries([...new FormData(form).entries()].map(([k, v]) => [k, String(v)]));
        void run(() => api(path, { method, body: transform ? transform(values) : values }), () => reset && form.reset());
      }}
    >
      {children}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" disabled={busy}>
          {icon}
          {submit}
        </Button>
      </div>
      <FormError error={error} />
    </form>
  );
}


/** Campaign flow: Idea → Research → Draft → AI review → Ready → Scheduled → Published → Analysis, with real counts. */
export function CampaignFlow({ steps, label }: { steps: { key: string; label: string; count: number }[]; label: string }) {
  const reduce = useReducedMotion();
  const w = 900;
  const gap = w / steps.length;
  const max = Math.max(1, ...steps.map((s) => s.count));
  return (
    <figure aria-label={label} className="overflow-x-auto">
      <svg viewBox={`0 0 ${w} 130`} className="h-auto min-w-[640px] w-full" role="img" aria-label={label}>
        <defs>
          <linearGradient id="flowGrad" x1="0" x2="1">
            <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.25" />
            <stop offset="100%" stopColor="var(--primary)" stopOpacity="0.9" />
          </linearGradient>
        </defs>
        <motion.path
          d={`M ${gap / 2} 50 L ${w - gap / 2} 50`}
          stroke="url(#flowGrad)"
          strokeWidth="3"
          fill="none"
          strokeDasharray="6 6"
          initial={reduce ? false : { pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 1.2, ease: "easeOut" }}
        />
        {steps.map((s, i) => {
          const cx = gap / 2 + i * gap;
          const r = 14 + (s.count / max) * 12;
          return (
            <g key={s.key}>
              <motion.circle
                cx={cx}
                cy={50}
                r={r}
                className={s.count ? "fill-primary" : "fill-muted"}
                fillOpacity={s.count ? 0.9 : 1}
                initial={reduce ? false : { scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ delay: reduce ? 0 : 0.12 * i, type: "spring", stiffness: 220, damping: 18 }}
                style={{ transformOrigin: `${cx}px 50px` }}
              >
                <title>{`${s.label}: ${s.count}`}</title>
              </motion.circle>
              <text x={cx} y={55} textAnchor="middle" className={`text-[13px] font-semibold ${s.count ? "fill-primary-foreground" : "fill-muted-foreground"}`}>
                {s.count}
              </text>
              <text x={cx} y={100} textAnchor="middle" className="fill-muted-foreground text-[12px]">
                {s.label}
              </text>
            </g>
          );
        })}
      </svg>
    </figure>
  );
}

/** Animated appearance wrapper for canvases (reduced-motion aware). */
export function Pop({ children, i = 0, className }: { children: ReactNode; i?: number; className?: string }) {
  const reduce = useReducedMotion();
  return (
    <motion.div className={className} initial={reduce ? false : { opacity: 0, y: 12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ delay: reduce ? 0 : Math.min(i, 10) * 0.05, duration: 0.35 }}>
      {children}
    </motion.div>
  );
}

export function AiBadge() {
  const t = useT();
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-brand-gradient px-2 py-0.5 text-[11px] font-medium text-primary-foreground">
      <Sparkles className="size-3" aria-hidden />
      {t("marketing.studio.aiLabel")}
    </span>
  );
}
