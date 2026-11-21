"use client";

import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useI18n } from "@/i18n/client";
import { formatMoney, minorUnits } from "@/i18n/format";
import { cn } from "@/lib/utils";
import { prefersReducedMotion } from "./use-reduced-motion";

export type CountUpFormat = "number" | "integer" | "percent" | "compact" | Intl.NumberFormatOptions;

const PRESETS: Record<Exclude<CountUpFormat, Intl.NumberFormatOptions>, Intl.NumberFormatOptions> = {
  number: { maximumFractionDigits: 2 },
  integer: { maximumFractionDigits: 0 },
  /** `value` is a ratio (0.42 → 42 %). */
  percent: { style: "percent", maximumFractionDigits: 1 },
  compact: { notation: "compact", maximumFractionDigits: 1 },
};

const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;
const easeOutExpo = (t: number) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));

/**
 * Animated number. It only animates the value it is given: the first paint and every final frame show the exact,
 * fully formatted value; screen readers always get the exact value (the animated digits are aria-hidden).
 * - `value`: the number to show (for money pass `money` instead).
 * - `format`: preset or Intl.NumberFormat options. `money`: integer minor units + ISO currency (exact via formatMoney).
 * Starts when scrolled into view; re-animates from the previous value when `value` changes. Honors reduced motion.
 */
export function CountUp({
  value,
  money,
  format = "number",
  duration = 900,
  className,
}: {
  value?: number;
  money?: { amountMinor: string | number | bigint; currency: string };
  format?: CountUpFormat;
  duration?: number;
  className?: string;
}) {
  const { locale } = useI18n();
  const ref = useRef<HTMLSpanElement>(null);
  const shown = useRef<number | null>(null);

  const target = money ? Number(money.amountMinor) / 10 ** minorUnits(money.currency) : (value ?? 0);
  const moneyKey = money ? `${money.amountMinor}:${money.currency}` : null;
  const formatKey = typeof format === "string" ? format : JSON.stringify(format);

  const { exact, fmt } = useMemo(() => {
    if (money && moneyKey) {
      const digits = minorUnits(money.currency);
      const nf = new Intl.NumberFormat(locale, { style: "currency", currency: money.currency, minimumFractionDigits: digits, maximumFractionDigits: digits });
      return { exact: formatMoney({ amountMinor: String(money.amountMinor), currency: money.currency }, locale), fmt: (n: number) => nf.format(n) };
    }
    const nf = new Intl.NumberFormat(locale, typeof format === "string" ? PRESETS[format] : format);
    return { exact: nf.format(target), fmt: (n: number) => nf.format(n) };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by serialized inputs
  }, [locale, moneyKey, formatKey, target]);

  // Before first paint (client only): when motion is allowed, start from zero; the IntersectionObserver below counts up.
  useIsoLayoutEffect(() => {
    const el = ref.current;
    if (!el || shown.current !== null) return;
    if (prefersReducedMotion() || target === 0) {
      shown.current = target;
      return;
    }
    shown.current = 0;
    el.textContent = fmt(0);
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const from = shown.current ?? target;
    if (prefersReducedMotion() || from === target) {
      el.textContent = exact;
      shown.current = target;
      return;
    }
    let raf = 0;
    let started = false;
    const run = () => {
      started = true;
      const t0 = performance.now();
      const tick = (now: number) => {
        const p = Math.min(1, (now - t0) / duration);
        const v = from + (target - from) * easeOutExpo(p);
        shown.current = v;
        if (p < 1) {
          el.textContent = fmt(v);
          raf = requestAnimationFrame(tick);
        } else {
          el.textContent = exact;
          shown.current = target;
        }
      };
      raf = requestAnimationFrame(tick);
    };
    const io = typeof IntersectionObserver !== "undefined"
      ? new IntersectionObserver((entries) => {
          if (!started && entries.some((e) => e.isIntersecting)) {
            io?.disconnect();
            run();
          }
        }, { threshold: 0.2 })
      : null;
    if (io) io.observe(el);
    else run();
    return () => {
      io?.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [target, exact, fmt, duration]);

  return (
    <span className={cn("tabular-nums", className)}>
      <span className="sr-only">{exact}</span>
      <span ref={ref} aria-hidden>
        {exact}
      </span>
    </span>
  );
}
