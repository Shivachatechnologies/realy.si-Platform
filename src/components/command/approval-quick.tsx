"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/form-error";
import { useT } from "@/i18n/client";
import { api } from "@/lib/api-client";

/** Approve / reject an AI proposal right from the Command Center (same decision API as /approvals). */
export function ApprovalQuick({ base, approvalId, summary }: { base: string; approvalId: string; summary: string }) {
  const t = useT();
  const router = useRouter();
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [error, setError] = useState<unknown>(null);
  const decide = async (decision: "approve" | "reject") => {
    setBusy(decision);
    setError(null);
    try {
      await api(`${base}/approvals/${approvalId}/decision`, { body: { decision } });
      router.refresh();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  };
  return (
    <span className="grid gap-1">
      <span className="flex items-center gap-1.5">
        <Button type="button" size="sm" loading={busy === "approve"} disabled={!!busy} onClick={() => void decide("approve")} aria-label={`${t("guide.command.approve")}: ${summary}`}>
          {busy === "approve" ? null : <Check aria-hidden />}
          {t("guide.command.approve")}
        </Button>
        <Button type="button" size="sm" variant="secondary" loading={busy === "reject"} disabled={!!busy} onClick={() => void decide("reject")} aria-label={`${t("guide.command.reject")}: ${summary}`}>
          {busy === "reject" ? null : <X aria-hidden />}
          {t("guide.command.reject")}
        </Button>
      </span>
      {error ? <FormError error={error} /> : null}
    </span>
  );
}
