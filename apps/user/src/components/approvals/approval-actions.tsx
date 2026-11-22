"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Check, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ReasonDialog } from "@/components/ui/reason-dialog";
import { useT } from "@/i18n/client";
import { api } from "@/lib/api-client";

/** Approve or reject a pending request; every decision carries a note that lands in the audit log. */
export function ApprovalActions({ base, summary }: { base: string; summary: string }) {
  const t = useT();
  const router = useRouter();
  const decide = (decision: "approve" | "reject") => async (note: string) => {
    await api(`${base}/decision`, { body: { decision, note } });
    router.refresh();
  };
  return (
    <div className="flex flex-wrap justify-end gap-2">
      <ReasonDialog
        trigger={
          <Button size="sm" variant="secondary">
            <X aria-hidden />
            {t("approvals.reject")}
          </Button>
        }
        title={t("approvals.reject")}
        description={summary}
        confirmLabel={t("approvals.reject")}
        onConfirm={decide("reject")}
      />
      <ReasonDialog
        trigger={
          <Button size="sm">
            <Check aria-hidden />
            {t("approvals.approve")}
          </Button>
        }
        title={t("approvals.approve")}
        description={`${summary} — ${t("approvals.approveHint")}`}
        confirmLabel={t("approvals.approveAndRun")}
        onConfirm={decide("approve")}
      />
    </div>
  );
}

/** Retry a failed approved action (B3): same checks as approving; the outcome flows back to the AI work that asked. */
export function ApprovalRetry({ base, attempts, maxAttempts }: { base: string; attempts: number; maxAttempts: number }) {
  const t = useT();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (attempts >= maxAttempts) return <p className="text-xs text-muted-foreground">{t("approvals.retryLimit")}</p>;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        size="sm"
        variant="secondary"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            await api(`${base}/retry`, { method: "POST" });
            router.refresh();
          } catch (e) {
            setError(e instanceof Error ? e.message : t("approvals.retryFailed"));
          } finally {
            setBusy(false);
          }
        }}
      >
        <RotateCcw aria-hidden />
        {busy ? t("approvals.retrying") : t("approvals.retry")}
      </Button>
      <span className="text-xs text-muted-foreground">{t("approvals.attempts", { count: attempts, max: maxAttempts })}</span>
      {error ? <p className="w-full text-xs text-danger">{error}</p> : null}
    </div>
  );
}
