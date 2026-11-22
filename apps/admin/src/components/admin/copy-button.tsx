"use client";

import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";
import { useT } from "@/i18n/client";
import { cn } from "@/lib/utils";

/**
 * Copy a value (id, email, key prefix) to the clipboard. Icon-only by default; `label` names what is copied for
 * screen readers ("Copy user id"). Shows a check for 1.5 s after copying.
 */
export function CopyButton({ value, label, showValue = false, className }: { value: string; label?: string; showValue?: boolean; className?: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(timer);
  }, [copied]);
  const name = copied ? t("admin.shell.copied") : label ? t("admin.shell.copyValue", { label }) : t("admin.shell.copy");
  return (
    <button
      type="button"
      title={name}
      aria-label={name}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
        } catch {
          /* clipboard unavailable (insecure context or denied): nothing to do */
        }
      }}
      className={cn(
        "inline-flex max-w-full items-center gap-1 rounded-md text-muted-foreground hover:text-foreground focus-visible:outline-2",
        showValue ? "px-1 font-mono text-xs hover:bg-muted" : "size-6 justify-center hover:bg-muted",
        className,
      )}
    >
      {showValue ? <span className="truncate">{value}</span> : null}
      {copied ? <Check className="size-3.5 shrink-0 text-success" aria-hidden /> : <Copy className="size-3.5 shrink-0" aria-hidden />}
      <span aria-live="polite" className="sr-only">
        {copied ? t("admin.shell.copied") : ""}
      </span>
    </button>
  );
}
