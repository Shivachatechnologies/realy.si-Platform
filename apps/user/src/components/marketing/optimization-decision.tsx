"use client";

import { useState } from "react";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormError } from "@/components/form-error";
import { SuccessBurst } from "@/components/motion/success-burst";
import { useT } from "@/i18n/client";
import { api } from "@/lib/api-client";
import { useAction } from "./ui";

/** Approve (applies the change now and records the provider's real outcome) or reject an optimization proposal. */
export function OptimizationDecision({ path, retry }: { path: string; retry?: boolean }) {
  const t = useT();
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState("");
  const [applied, setApplied] = useState(false);
  const { busy, error, run } = useAction();
  return (
    <div className="grid gap-2">
      <div className="relative flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          disabled={busy}
          onClick={() => {
            if (!window.confirm(t("marketing.optimize.confirmApply"))) return;
            void run(
              () => api<{ status: string }>(path, { body: { decision: "approve" } }),
              (r) => setApplied(r.status === "APPLIED"),
            );
          }}
        >
          <Check aria-hidden />
          {busy ? t("marketing.optimize.applying") : retry ? t("marketing.optimize.retryApply") : t("marketing.optimize.approve")}
        </Button>
        <SuccessBurst active={applied} size={56} className="pointer-events-none absolute -top-4 start-4" />
        {!rejecting ? (
          <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => setRejecting(true)}>
            <X aria-hidden />
            {t("marketing.optimize.reject")}
          </Button>
        ) : (
          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void run(() => api(path, { body: { decision: "reject", note: note.trim() || undefined } }));
            }}
          >
            <Input value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} placeholder={t("marketing.optimize.rejectReason")} aria-label={t("marketing.optimize.rejectReason")} className="h-8 w-56" />
            <Button type="submit" size="sm" variant="secondary" disabled={busy}>
              {t("marketing.optimize.reject")}
            </Button>
          </form>
        )}
      </div>
      <FormError error={error} />
    </div>
  );
}
