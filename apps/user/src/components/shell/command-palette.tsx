"use client";

import { Command } from "cmdk";
import { Dialog as D } from "radix-ui";
import { useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import { Search } from "lucide-react";
import { useI18n } from "@/i18n/client";
import { dialogOverlayClass, dialogPanelClass } from "@/components/ui/dialog";
import { ADMIN_NAV, NAV } from "./nav";

const noopSubscribe = () => () => {};
/** Platform-correct shortcut hint (⌘K on Apple platforms, Ctrl K elsewhere); server render assumes Ctrl. */
function useShortcutHint() {
  const isApple = useSyncExternalStore(noopSubscribe, () => /Mac|iPhone|iPad/.test(navigator.userAgent), () => false);
  return isApple ? "⌘K" : "Ctrl K";
}

/** ⌘K / Ctrl+K: jump anywhere. */
export function CommandPalette({ showAdmin }: { showAdmin: boolean }) {
  const shortcut = useShortcutHint();
  const { t, locale } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const go = (href: string) => {
    setOpen(false);
    router.push(`/${locale}${href}`);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t("common.searchPlaceholder")}
        className="group flex h-8 w-8 shrink-0 items-center justify-center gap-2 rounded-md border bg-surface/70 text-xs pointer-coarse:size-10 sm:w-full sm:max-w-72 sm:justify-start sm:px-2.5 sm:pointer-coarse:w-full text-muted-foreground shadow-elev-1 transition-[background-color,border-color,box-shadow] hover:border-border-strong hover:bg-surface hover:text-foreground"
      >
        <Search className="size-3.5" aria-hidden />
        <span className="hidden truncate sm:inline">{t("common.searchPlaceholder")}</span>
        <kbd className="ms-auto hidden rounded border bg-muted px-1.5 py-px font-mono text-[10px] whitespace-nowrap shadow-[inset_0_-1px_0_var(--border)] sm:inline" dir="ltr">{shortcut}</kbd>
      </button>
      <D.Root open={open} onOpenChange={setOpen}>
        <D.Portal>
          <D.Overlay className={dialogOverlayClass} />
          <D.Content className={`${dialogPanelClass} top-[15vh] w-[calc(100%-2rem)] max-w-xl overflow-hidden`}>
            <D.Title className="sr-only">{t("nav.commandPalette")}</D.Title>
            <Command label={t("nav.commandPalette")} className="flex flex-col">
              <div className="flex items-center gap-2 border-b px-4">
                <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                <Command.Input autoFocus placeholder={t("common.searchPlaceholder")} className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground" />
                <kbd className="hidden rounded border bg-muted px-1.5 py-px font-mono text-[10px] text-muted-foreground sm:inline" dir="ltr">Esc</kbd>
              </div>
              <Command.List className="max-h-[50vh] overflow-y-auto p-2">
                <Command.Empty className="px-3 py-6 text-center text-sm text-muted-foreground">{t("common.noResults")}</Command.Empty>
                {NAV.map((section, i) => (
                  <Command.Group key={i} heading={section.label ? t(section.label) : undefined} className="text-xs text-muted-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pt-2.5 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-[10.5px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:tracking-[0.08em] [&_[cmdk-group-heading]]:uppercase">
                    {section.items.map((item) => (
                      <Command.Item
                        key={item.href}
                        value={`${t(item.label)} ${item.href}`}
                        onSelect={() => go(item.href)}
                        className="group/item flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-2 pointer-coarse:min-h-11 text-sm text-foreground transition-colors data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground"
                      >
                        <item.icon className="size-4 text-muted-foreground group-data-[selected=true]/item:text-primary rtl:-scale-x-100" aria-hidden />
                        {t(item.label)}
                      </Command.Item>
                    ))}
                  </Command.Group>
                ))}
                {showAdmin ? (
                  <Command.Item
                    value={t(ADMIN_NAV.label)}
                    onSelect={() => go(ADMIN_NAV.href)}
                    className="group/item flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-2 text-sm transition-colors data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground"
                  >
                    <ADMIN_NAV.icon className="size-4 text-muted-foreground" aria-hidden />
                    {t(ADMIN_NAV.label)}
                  </Command.Item>
                ) : null}
              </Command.List>
            </Command>
          </D.Content>
        </D.Portal>
      </D.Root>
    </>
  );
}
