"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Select } from "@/components/ui/input";
import { useI18n } from "@/i18n/client";
import { ActionDialog, useAdminAction } from "./action-dialog";

const PATH = "/api/v1/admin/ai/tiers";
const TIERS = ["simple", "standard", "complex"] as const;
type Tier = (typeof TIERS)[number];

/**
 * Edit the agent tier routing of one profile class (or the platform-wide row "*"): which model simple, standard and
 * complex runs use. Empty = inherit (class → platform row → built-in default). Audited with a reason (B14).
 */
export function TierRowEditor({ profileClass, label, current, models }: { profileClass: string; label: string; current: Partial<Record<Tier, string | null>>; models: string[] }) {
  const { t } = useI18n();
  const run = useAdminAction();
  const [v, setV] = useState<Record<Tier, string>>({ simple: current.simple ?? "", standard: current.standard ?? "", complex: current.complex ?? "" });
  return (
    <ActionDialog
      trigger={
        <Button size="sm" variant="ghost">
          {t("admin.aiModels.tiersEdit")}
        </Button>
      }
      title={t("admin.aiModels.tiersEditTitle", { name: label })}
      description={t("admin.aiModels.tiersEditHint")}
      confirmLabel={t("common.save")}
      onConfirm={(reason) => run(PATH, "PUT", { profileClass, tiers: { simple: v.simple || null, standard: v.standard || null, complex: v.complex || null }, reason })}
    >
      <div className="grid gap-3">
        {TIERS.map((tier) => (
          <Field key={tier} label={t(`admin.aiModels.tier.${tier}`)} htmlFor={`tier-${profileClass}-${tier}`}>
            <Select id={`tier-${profileClass}-${tier}`} value={v[tier]} onChange={(e) => setV((s) => ({ ...s, [tier]: e.target.value }))}>
              <option value="">{t("admin.aiModels.tiersInherit")}</option>
              {models.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </Select>
          </Field>
        ))}
      </div>
    </ActionDialog>
  );
}

/** Turn tier routing on or off (off = every run uses the class / platform default model). */
export function TierRoutingToggle({ enabled }: { enabled: boolean }) {
  const { t } = useI18n();
  const run = useAdminAction();
  return (
    <ActionDialog
      trigger={
        <Button size="sm" variant={enabled ? "secondary" : "default"}>
          {enabled ? t("admin.aiModels.disable") : t("admin.aiModels.enable")}
        </Button>
      }
      title={enabled ? t("admin.aiModels.tiersDisable") : t("admin.aiModels.tiersEnable")}
      confirmLabel={enabled ? t("admin.aiModels.disable") : t("admin.aiModels.enable")}
      onConfirm={(reason) => run(PATH, "PUT", { enabled: !enabled, reason })}
    />
  );
}
