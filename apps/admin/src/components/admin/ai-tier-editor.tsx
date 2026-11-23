"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select } from "@/components/ui/input";
import { useI18n } from "@/i18n/client";
import { ActionDialog, useAdminAction } from "./action-dialog";

const PATH = "/api/v1/admin/ai/tiers";
const TIERS = ["simple", "standard", "complex", "coding", "creative"] as const;
type Tier = (typeof TIERS)[number];
/** Tiers holding a provider-specific id (free text), kept as they are unless edited. */
const FREE = ["embedding", "voice", "image", "video"] as const;
type Free = (typeof FREE)[number];

/**
 * Edit the tier routing of one profile class (or the platform-wide row "*"): which model simple, standard, complex,
 * coding and creative runs use, and the embedding model id. Empty = inherit (class → platform row → built-in default;
 * coding / creative fall back to the run's complexity tier). Voice, image and video values are preserved. Audited.
 */
export function TierRowEditor({ profileClass, label, current, models }: { profileClass: string; label: string; current: Partial<Record<Tier | Free, string | null>>; models: string[] }) {
  const { t } = useI18n();
  const run = useAdminAction();
  const [v, setV] = useState<Record<Tier, string>>({ simple: current.simple ?? "", standard: current.standard ?? "", complex: current.complex ?? "", coding: current.coding ?? "", creative: current.creative ?? "" });
  const [embedding, setEmbedding] = useState(current.embedding ?? "");
  const kept = Object.fromEntries(FREE.filter((f) => f !== "embedding").map((f) => [f, current[f] ?? null]));
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
      canSubmit={embedding === "" || /^[A-Za-z0-9._:@/-]{2,80}$/.test(embedding)}
      onConfirm={(reason) =>
        run(PATH, "PUT", { profileClass, tiers: { ...kept, ...Object.fromEntries(TIERS.map((x) => [x, v[x] || null])), embedding: embedding.trim() || null }, reason })
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
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
        <Field label={t("admin.aiModels.tier.embedding")} htmlFor={`tier-${profileClass}-embedding`} hint={t("admin.aiModels.embeddingHint")}>
          <Input id={`tier-${profileClass}-embedding`} value={embedding} onChange={(e) => setEmbedding(e.target.value)} className="font-mono" spellCheck={false} />
        </Field>
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
