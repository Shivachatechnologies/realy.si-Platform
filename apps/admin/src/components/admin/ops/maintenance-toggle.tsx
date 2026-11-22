"use client";

import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { useI18n } from "@/i18n/client";
import { ActionDialog, useAdminAction } from "../action-dialog";

/** Maintenance on/off. Turning it on needs the typed phrase (in production prefixed with "PRODUCTION "). */
export function MaintenanceToggle({ on, phrase = "maintenanceMode", production = false }: { on: boolean; phrase?: string; production?: boolean }) {
  const { t } = useI18n();
  const run = useAdminAction();
  const label = on ? t("admin.ops.maintenanceOff") : t("admin.ops.maintenanceOn");
  return (
    <ActionDialog
      trigger={
        <Button size="sm" variant={on ? "default" : "danger"}>
          {label}
        </Button>
      }
      title={label}
      description={on ? undefined : t("admin.ops.maintenanceHint")}
      confirmLabel={label}
      phrase={on ? undefined : phrase}
      danger={!on}
      onConfirm={(reason, confirm) => run("/api/v1/admin/ops/maintenance", "PUT", { on: !on, reason, confirm })}
    >
      {production && !on ? <Notice tone="danger">{t("admin.system.env.productionWarning")}</Notice> : null}
    </ActionDialog>
  );
}
