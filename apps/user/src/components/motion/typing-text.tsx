"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { useReducedMotion } from "./use-reduced-motion";

/**
 * Types out a real status line (e.g. the current step of an AI task) character by character.
 * The full text is always available to assistive tech; the typed copy is decorative. Reduced motion shows it at once.
 */
export function TypingText({
  text,
  speed = 28,
  caret = true,
  className,
}: {
  text: string;
  /** ms per character */
  speed?: number;
  caret?: boolean;
  className?: string;
}) {
  const reduced = useReducedMotion();
  const [progress, setProgress] = useState({ text, n: 0 });
  const chars = Array.from(text);
  const n = reduced ? chars.length : progress.text === text ? progress.n : 0;
  const done = n >= chars.length;

  useEffect(() => {
    if (reduced) return;
    const total = Array.from(text).length;
    const id = window.setInterval(() => {
      setProgress((p) => {
        const cur = p.text === text ? p.n : 0;
        if (cur >= total) {
          window.clearInterval(id);
          return p.text === text ? p : { text, n: total };
        }
        return { text, n: cur + 1 };
      });
    }, speed);
    return () => window.clearInterval(id);
  }, [text, speed, reduced]);

  const shown = chars.slice(0, n).join("");
  return (
    <span className={cn("inline", className)}>
      <span className="sr-only">{text}</span>
      <span aria-hidden>
        {shown}
        {caret && !done ? <span className="typing-caret" /> : null}
      </span>
    </span>
  );
}
