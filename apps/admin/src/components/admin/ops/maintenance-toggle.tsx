"use client";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n/client";
import { ActionDialog, useAdminAction } from "../action-dialog";

export function MaintenanceToggle({ on }: { on: boolean }) {
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
      phrase={on ? undefined : "maintenanceMode"}
      danger={!on}
      onConfirm={(reason, confirm) => run("/api/v1/admin/ops/maintenance", "PUT", { on: !on, reason, confirm })}
    />
  );
}
