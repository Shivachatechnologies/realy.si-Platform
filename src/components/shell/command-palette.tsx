"use client";

import { Command } from "cmdk";
import { Dialog as D } from "radix-ui";
import { useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import { Search } from "lucide-react";
import { useI18n } from "@/i18n/client";
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
        className="flex h-8 w-full max-w-72 items-center gap-2 rounded-md border bg-surface px-2.5 text-xs text-muted-foreground hover:bg-muted"
      >
        <Search className="size-3.5" aria-hidden />
        <span className="truncate">{t("common.searchPlaceholder")}</span>
        <kbd className="ms-auto hidden rounded border bg-muted px-1 font-mono text-[10px] whitespace-nowrap sm:inline" dir="ltr">{shortcut}</kbd>
      </button>
      <D.Root open={open} onOpenChange={setOpen}>
        <D.Portal>
          <D.Overlay className="fixed inset-0 z-50 bg-black/50" />
          <D.Content className="fixed start-1/2 top-[15vh] z-50 w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 overflow-hidden rounded-lg border bg-surface shadow-2xl rtl:translate-x-1/2">
            <D.Title className="sr-only">{t("nav.commandPalette")}</D.Title>
            <Command label={t("nav.commandPalette")} className="flex flex-col">
              <Command.Input autoFocus placeholder={t("common.searchPlaceholder")} className="h-11 border-b bg-transparent px-4 text-sm outline-none" />
              <Command.List className="max-h-[50vh] overflow-y-auto p-2">
                <Command.Empty className="px-3 py-6 text-center text-sm text-muted-foreground">{t("common.noResults")}</Command.Empty>
                {NAV.map((section, i) => (
                  <Command.Group key={i} heading={section.label ? t(section.label) : undefined} className="text-xs text-muted-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5">
                    {section.items.map((item) => (
                      <Command.Item
                        key={item.href}
                        value={`${t(item.label)} ${item.href}`}
                        onSelect={() => go(item.href)}
                        className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm text-foreground data-[selected=true]:bg-muted"
                      >
                        <item.icon className="size-4 text-muted-foreground" aria-hidden />
                        {t(item.label)}
                        {item.phase ? <span className="ms-auto font-mono text-[10px] text-muted-foreground">{t("nav.phaseShort", { phase: item.phase })}</span> : null}
                      </Command.Item>
                    ))}
                  </Command.Group>
                ))}
                {showAdmin ? (
                  <Command.Item
                    value={t(ADMIN_NAV.label)}
                    onSelect={() => go(ADMIN_NAV.href)}
                    className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm data-[selected=true]:bg-muted"
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
