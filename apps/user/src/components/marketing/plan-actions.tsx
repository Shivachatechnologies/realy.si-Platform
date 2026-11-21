"use client";

import { useState } from "react";
import { MessageSquareWarning } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormError } from "@/components/form-error";
import { useT } from "@/i18n/client";
import { api } from "@/lib/api-client";
import { useAction } from "./ui";

/** Reviewer sends a plan back to draft with a note for its author. */
export function RequestPlanChanges({ path }: { path: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const { busy, error, run } = useAction();
  if (!open)
    return (
      <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(true)}>
        <MessageSquareWarning aria-hidden />
        {t("marketing.strategy.actions.requestChanges")}
      </Button>
    );
  return (
    <form
      className="flex w-full flex-wrap items-start gap-2 sm:w-auto"
      onSubmit={(e) => {
        e.preventDefault();
        void run(() => api(path, { body: { action: "request_changes", note: note.trim() } }), () => setOpen(false));
      }}
    >
      <Input autoFocus required maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("marketing.strategy.actions.changesPlaceholder")} aria-label={t("marketing.strategy.actions.changesPlaceholder")} className="min-w-0 flex-1 sm:w-72" />
      <Button type="submit" size="sm" disabled={busy || !note.trim()}>
        {t("marketing.strategy.actions.sendBack")}
      </Button>
      <FormError error={error} />
    </form>
  );
}
