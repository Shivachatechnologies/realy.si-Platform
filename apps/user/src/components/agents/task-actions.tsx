"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/form-error";
import { useT } from "@/i18n/client";
import { api } from "@/lib/api-client";

export function TaskActions({ base, canCancel, canRetry }: { base: string; canCancel: boolean; canRetry: boolean }) {
  const t = useT();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function act(action: "cancel" | "retry") {
    if (action === "cancel" && !window.confirm(t("agentTasks.confirmCancel"))) return;
    setBusy(true);
    setError(null);
    try {
      await api(`${base}/${action}`, { method: "POST" });
      router.refresh();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  if (!canCancel && !canRetry) return null;
  return (
    <div className="grid justify-items-end gap-1">
      <div className="flex gap-2">
        {canCancel ? (
          <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => act("cancel")}>
            <Square aria-hidden />
            {t("agentTasks.cancel")}
          </Button>
        ) : null}
        {canRetry ? (
          <Button type="button" size="sm" disabled={busy} onClick={() => act("retry")}>
            <RotateCcw aria-hidden />
            {t("agentTasks.retry")}
          </Button>
        ) : null}
      </div>
      <FormError error={error} />
    </div>
  );
}
