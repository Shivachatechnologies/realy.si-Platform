"use client";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n/client";
import { ActionDialog, useAdminAction } from "../action-dialog";

export function RevokeSession({ sessionId }: { sessionId: string }) {
  const { t } = useI18n();
  const run = useAdminAction();
  return (
    <ActionDialog
      trigger={
        <Button size="sm" variant="ghost" className="text-danger">
          {t("admin.securityAccess.revoke")}
        </Button>
      }
      title={t("admin.securityAccess.revokeTitle")}
      confirmLabel={t("admin.securityAccess.revoke")}
      danger
      onConfirm={(reason) => run(`/api/v1/admin/sessions/${sessionId}`, "DELETE", { reason })}
    />
  );
}
