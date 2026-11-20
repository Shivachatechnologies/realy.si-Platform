"use client";

import { Dialog as D } from "radix-ui";
import type { ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export const Dialog = D.Root;
export const DialogTrigger = D.Trigger;
export const DialogClose = D.Close;

/** Shared overlay: dim + blur, fades in/out. */
export const dialogOverlayClass =
  "fixed inset-0 z-50 bg-[oklch(0.12_0.02_275/0.45)] backdrop-blur-[3px] data-[state=open]:animate-overlay-in data-[state=closed]:animate-overlay-out";
/** Shared panel: glass surface, layered shadow, scale/fade in and out (opacity + scale only; centring uses translate). */
export const dialogPanelClass =
  "fixed start-1/2 z-50 -translate-x-1/2 rounded-xl border glass-strong shadow-elev-4 outline-none rtl:translate-x-1/2 data-[state=open]:animate-dialog-in data-[state=closed]:animate-dialog-out";

export function DialogContent({
  title,
  description,
  children,
  closeLabel,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  closeLabel: string;
  className?: string;
}) {
  return (
    <D.Portal>
      <D.Overlay className={dialogOverlayClass} />
      <D.Content className={cn(dialogPanelClass, "top-[12vh] grid max-h-[80vh] w-[calc(100%-2rem)] max-w-lg gap-4 overflow-y-auto p-5", className)}>
        <div className="grid gap-1 pe-6">
          <D.Title className="text-base font-semibold tracking-tight">{title}</D.Title>
          {description ? <D.Description className="text-sm text-muted-foreground">{description}</D.Description> : null}
        </div>
        {children}
        <D.Close
          className="absolute end-3 top-3 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label={closeLabel}
        >
          <X className="size-4" />
        </D.Close>
      </D.Content>
    </D.Portal>
  );
}
