"use client";

import { useEffect, useRef } from "react";
import { animate, useInView } from "motion/react";
import { useI18n } from "@/i18n/client";
import { useReducedMotion } from "./use-reduced-motion";

/**
 * A number that animates between values (not only from zero): on first view it counts up, on later prop changes it
 * glides from the previous value. Formatting via Intl.NumberFormat (`options`), or `money` (minor units + currency).
 * The final value is always the exact value given; screen readers get it immediately.
 */
export function AnimatedNumber({
  value,
  options,
  money,
  className,
  duration = 1.1,
}: {
  value: number;
  options?: Intl.NumberFormatOptions;
  /** Minor units of `currency` (`minorDigits` defaults to the currency's own digits); shown with `fractionDigits` (default 0). */
  money?: { currency: string; minorDigits?: number; fractionDigits?: number };
  className?: string;
  duration?: number;
}) {
  const { locale } = useI18n();
  const reduced = useReducedMotion();
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.4 });
  const prev = useRef<number | null>(null);
  const fmtOpts: Intl.NumberFormatOptions = money
    ? { style: "currency", currency: money.currency, maximumFractionDigits: money.fractionDigits ?? 0 }
    : (options ?? {});
  const minor = money ? (money.minorDigits ?? (new Intl.NumberFormat("en", { style: "currency", currency: money.currency }).resolvedOptions().maximumFractionDigits ?? 2)) : 0;
  const display = (n: number) => new Intl.NumberFormat(locale, fmtOpts).format(money ? n / 10 ** minor : n);
  const optsKey = JSON.stringify(fmtOpts);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (reduced || !inView) {
      if (reduced) el.textContent = display(value);
      return;
    }
    const from = prev.current ?? 0;
    prev.current = value;
    const controls = animate(from, value, {
      duration,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => {
        el.textContent = display(v);
      },
    });
    return () => controls.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, inView, reduced, locale, optsKey, duration]);

  return (
    <span className={className}>
      <span className="sr-only">{display(value)}</span>
      <span ref={ref} aria-hidden className="numeral">
        {display(value)}
      </span>
    </span>
  );
}
