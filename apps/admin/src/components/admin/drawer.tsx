"use client";

import type { ReactNode } from "react";
import { Dialog as D } from "radix-ui";
import { PanelRightOpen, X } from "lucide-react";
import { dialogOverlayClass } from "@/components/ui/dialog";
import { useT } from "@/i18n/client";
import { cn } from "@/lib/utils";

/**
 * Side drawer for quick actions on a list row (slides in from the inline end; full width on phones).
 * Content is server-rendered and passed as children; nested action dialogs work inside it.
 */
export function SideDrawer({ label, title, description, header, children, triggerClassName }: { label: string; title: string; description?: string; header?: ReactNode; children: ReactNode; triggerClassName?: string }) {
  const t = useT();
  return (
    <D.Root>
      <D.Trigger asChild>
        <button
          type="button"
          aria-label={`${label}: ${title}`}
          className={cn(
            "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border bg-surface px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground focus-visible:outline-2",
            triggerClassName,
          )}
        >
          <PanelRightOpen className="size-3.5 rtl:-scale-x-100" aria-hidden />
          <span className="hidden sm:inline">{label}</span>
        </button>
      </D.Trigger>
      <D.Portal>
        <D.Overlay className={dialogOverlayClass} />
        <D.Content className="fixed inset-y-0 end-0 z-50 flex w-full max-w-md flex-col border-s glass-strong shadow-elev-4 outline-none data-[state=open]:animate-[drawer-in_0.35s_var(--ease-out-expo)] data-[state=closed]:animate-[drawer-out_0.2s_ease-in] motion-reduce:animate-none">
          <style>{`@keyframes drawer-in{from{transform:translateX(var(--drawer-from,100%));opacity:.4}to{transform:none;opacity:1}}@keyframes drawer-out{to{transform:translateX(var(--drawer-from,100%));opacity:0}}[dir=rtl]{--drawer-from:-100%}`}</style>
          <div className="flex items-start gap-3 border-b px-5 py-4">
            {header}
            <div className="min-w-0 flex-1">
              <D.Title className="truncate text-base font-semibold tracking-tight">{title}</D.Title>
              {description ? <D.Description className="truncate text-xs text-muted-foreground">{description}</D.Description> : <D.Description className="sr-only">{label}</D.Description>}
            </div>
            <D.Close className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2" aria-label={t("common.close")}>
              <X className="size-4" />
            </D.Close>
          </div>
          <div className="grid flex-1 content-start gap-5 overflow-y-auto px-5 py-4">{children}</div>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

/** Labeled block inside a drawer. */
export function DrawerSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid gap-2">
      <h3 className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{title}</h3>
      {children}
    </section>
  );
}
