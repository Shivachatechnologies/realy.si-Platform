"use client";

import { Dialog as D } from "radix-ui";
import type { ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export const Dialog = D.Root;
export const DialogTrigger = D.Trigger;
export const DialogClose = D.Close;

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
      <D.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-[1px]" />
      <D.Content
        className={cn(
          "fixed start-1/2 top-[12vh] z-50 grid max-h-[80vh] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 gap-4 overflow-y-auto rounded-lg border bg-surface p-5 shadow-xl rtl:translate-x-1/2",
          className,
        )}
      >
        <div className="grid gap-1 pe-6">
          <D.Title className="text-base font-semibold">{title}</D.Title>
          {description ? <D.Description className="text-sm text-muted-foreground">{description}</D.Description> : null}
        </div>
        {children}
        <D.Close className="absolute end-3 top-3 rounded-sm p-1 text-muted-foreground hover:bg-muted" aria-label={closeLabel}>
          <X className="size-4" />
        </D.Close>
      </D.Content>
    </D.Portal>
  );
}
