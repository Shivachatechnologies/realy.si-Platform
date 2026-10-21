"use client";

import { useRouter } from "next/navigation";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ReasonDialog } from "@/components/admin/reason-dialog";
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
