"use client";

import { Dialog, DialogContent } from "@/components/ui/dialog";
import { useT } from "@/i18n/client";

const KEYS: { keys: string[]; label: string }[] = [
  { keys: ["⌘", "K"], label: "admin.palette.keys.palette" },
  { keys: ["/"], label: "admin.palette.keys.search" },
  { keys: ["?"], label: "admin.palette.keys.help" },
  { keys: ["["], label: "admin.palette.keys.sidebar" },
  { keys: ["↑", "↓"], label: "admin.palette.keys.move" },
  { keys: ["→", "←"], label: "admin.palette.keys.expand" },
  { keys: ["Enter"], label: "admin.palette.keys.open" },
  { keys: ["Esc"], label: "admin.palette.keys.close" },
];

/** Keyboard shortcut reference ("?" anywhere outside a text field). */
export function ShortcutsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const t = useT();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={t("admin.palette.keys.title")} description={t("admin.palette.keys.hint")} closeLabel={t("common.close")}>
        <dl className="grid gap-2 text-sm">
          {KEYS.map((k) => (
            <div key={k.label} className="flex items-center justify-between gap-4 border-b pb-2 last:border-0">
              <dt className="text-muted-foreground">{t(k.label)}</dt>
              <dd className="flex gap-1">
                {k.keys.map((key) => (
                  <kbd key={key} className="min-w-6 rounded border bg-muted px-1.5 py-0.5 text-center font-mono text-xs">
                    {key}
                  </kbd>
                ))}
              </dd>
            </div>
          ))}
        </dl>
      </DialogContent>
    </Dialog>
  );
}
