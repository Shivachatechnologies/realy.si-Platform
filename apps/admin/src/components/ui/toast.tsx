"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CircleCheck, Info, OctagonAlert, TriangleAlert, X } from "lucide-react";
import { useT } from "@/i18n/client";
import { cn } from "@/lib/utils";

export type ToastTone = "success" | "info" | "warning" | "danger";

export interface ToastInput {
  title: ReactNode;
  description?: ReactNode;
  tone?: ToastTone;
  /** Milliseconds before it closes on its own; 0 keeps it until dismissed. Default 5000 (danger: 8000). */
  duration?: number;
}

interface ToastItem extends ToastInput {
  id: number;
}

interface ToastApi {
  toast: (t: ToastInput) => number;
  success: (title: ReactNode, description?: ReactNode) => number;
  error: (title: ReactNode, description?: ReactNode) => number;
  dismiss: (id: number) => void;
}

const noop: ToastApi = { toast: () => 0, success: () => 0, error: () => 0, dismiss: () => {} };
const ToastContext = createContext<ToastApi | null>(null);

/** Toasts of the current admin page. Outside a <ToastProvider> it is a no-op, so components stay usable anywhere. */
export function useToast(): ToastApi {
  return useContext(ToastContext) ?? noop;
}

const ICON = { success: CircleCheck, info: Info, warning: TriangleAlert, danger: OctagonAlert } as const;
const ACCENT = { success: "[--toast-accent:var(--success)]", info: "[--toast-accent:var(--info)]", warning: "[--toast-accent:var(--warning)]", danger: "[--toast-accent:var(--danger)]" } as const;

/**
 * Transient confirmations ("Saved", "Session revoked") in a polite live region at the bottom end of the screen.
 * Errors keep showing inline in their form (FormError); toasts are for outcomes the page does not show by itself.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const t = useT();
  const [items, setItems] = useState<ToastItem[]>([]);
  const next = useRef(1);
  const dismiss = useCallback((id: number) => setItems((xs) => xs.filter((x) => x.id !== id)), []);
  const toast = useCallback((input: ToastInput) => {
    const id = next.current++;
    setItems((xs) => [...xs.slice(-3), { ...input, id }]);
    return id;
  }, []);
  const api = useMemo<ToastApi>(
    () => ({ toast, dismiss, success: (title, description) => toast({ title, description, tone: "success" }), error: (title, description) => toast({ title, description, tone: "danger" }) }),
    [toast, dismiss],
  );
  return (
    <ToastContext.Provider value={api}>
      {children}
      <ol aria-live="polite" aria-label={t("admin.shell.notifications")} className="pointer-events-none fixed end-4 bottom-4 z-[60] grid w-[min(24rem,calc(100vw-2rem))] gap-2">
        {items.map((item) => (
          <ToastRow key={item.id} item={item} onClose={() => dismiss(item.id)} closeLabel={t("admin.shell.dismiss")} />
        ))}
      </ol>
    </ToastContext.Provider>
  );
}

function ToastRow({ item, onClose, closeLabel }: { item: ToastItem; onClose: () => void; closeLabel: string }) {
  const tone = item.tone ?? "info";
  const Icon = ICON[tone];
  const duration = item.duration ?? (tone === "danger" ? 8000 : 5000);
  useEffect(() => {
    if (!duration) return;
    const timer = window.setTimeout(onClose, duration);
    return () => window.clearTimeout(timer);
  }, [duration, onClose]);
  return (
    <li
      role={tone === "danger" ? "alert" : "status"}
      className={cn("pointer-events-auto relative flex items-start gap-2.5 overflow-hidden rounded-lg border bg-surface px-3 py-2.5 text-sm shadow-elev-3 animate-scale-in", ACCENT[tone])}
    >
      <span aria-hidden className="absolute inset-y-0 start-0 w-0.5 bg-(--toast-accent)" />
      <Icon className="mt-0.5 size-4 shrink-0 text-(color:--toast-accent)" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="font-medium text-foreground">{item.title}</p>
        {item.description ? <div className="mt-0.5 text-xs text-muted-foreground">{item.description}</div> : null}
      </div>
      <button type="button" onClick={onClose} aria-label={closeLabel} className="-me-1 grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2">
        <X className="size-3.5" aria-hidden />
      </button>
    </li>
  );
}
