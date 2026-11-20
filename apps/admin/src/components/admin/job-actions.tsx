"use client";

import { useRouter } from "next/navigation";
import { RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ReasonDialog } from "@/components/admin/reason-dialog";
import { useT } from "@/i18n/client";
import { api } from "@/lib/api-client";

/** Requeue / discard a dead-lettered job (platform.controls.manage; the reason lands in the audit log). */
export function DeadJobActions({ runId, requeueable }: { runId: string; requeueable: boolean }) {
  const t = useT();
  const router = useRouter();
  const act = (action: "requeue" | "discard") => async (reason: string) => {
    await api(`/api/v1/admin/jobs/${runId}/${action}`, { body: { reason } });
    router.refresh();
  };
  return (
    <div className="flex flex-wrap gap-1">
      {requeueable ? (
        <ReasonDialog
          trigger={
            <Button size="sm" variant="secondary" className="min-h-11 sm:min-h-8">
              <RotateCcw aria-hidden />
              {t("admin.system.jobs.requeue")}
            </Button>
          }
          title={t("admin.system.jobs.requeueTitle")}
          description={t("admin.system.jobs.requeueBody")}
          confirmLabel={t("admin.system.jobs.requeue")}
          onConfirm={act("requeue")}
        />
      ) : null}
      <ReasonDialog
        trigger={
          <Button size="sm" variant="ghost" className="min-h-11 sm:min-h-8">
            <Trash2 aria-hidden />
            {t("admin.system.jobs.discard")}
          </Button>
        }
        title={t("admin.system.jobs.discardTitle")}
        description={t("admin.system.jobs.discardBody")}
        confirmLabel={t("admin.system.jobs.discard")}
        onConfirm={act("discard")}
      />
    </div>
  );
}
