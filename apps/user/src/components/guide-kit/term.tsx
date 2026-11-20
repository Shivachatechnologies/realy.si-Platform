"use client";

import { useId, useState, type ReactNode } from "react";
import { HelpCircle } from "lucide-react";

/** A jargon word with a "what's this?" explanation that opens inline (keyboard and screen-reader friendly). */
export function Term({ children, explain, label }: { children: ReactNode; explain: ReactNode; label?: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <span className="relative inline">
      <span className="underline decoration-dotted underline-offset-4">{children}</span>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        aria-label={label ?? "?"}
        onClick={() => setOpen((v) => !v)}
        className="ms-0.5 inline-grid size-4 translate-y-0.5 place-items-center rounded-full text-muted-foreground hover:text-primary focus-visible:outline-2"
      >
        <HelpCircle className="size-3.5" aria-hidden />
      </button>
      {open ? (
        <span id={id} role="note" className="mt-1 block rounded-md border bg-surface-2 px-2 py-1.5 text-xs font-normal text-muted-foreground animate-fade-in">
          {explain}
        </span>
      ) : null}
    </span>
  );
}
