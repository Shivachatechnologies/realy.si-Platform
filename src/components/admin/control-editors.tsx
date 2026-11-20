"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select, Textarea } from "@/components/ui/input";
import { useI18n } from "@/i18n/client";
import { cn } from "@/lib/utils";
import { ActionDialog, useAdminAction } from "./action-dialog";

const CONTROLS_API = "/api/v1/admin/controls";

/**
 * One boolean platform switch. `on` is the current value; `normal` the safe default. Moving a critical switch away
 * from normal operation requires the typed phrase (the control key) — the server enforces the same rule.
 */
export function ControlSwitch({
  controlKey,
  value,
  normal,
  critical,
  canManage,
  label,
  description,
  locked,
}: {
  controlKey: string;
  value: boolean;
  normal: boolean;
  critical?: boolean;
  canManage: boolean;
  label: string;
  description?: string;
  locked?: boolean;
}) {
  const { t } = useI18n();
  const run = useAdminAction();
  const next = !value;
  const abnormal = value !== normal;
  return (
    <div className="flex items-start gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{label}</span>
          {abnormal ? <Badge tone="warning">{t("admin.controls.changed")}</Badge> : null}
          {critical ? <Badge tone="danger">{t("admin.controls.critical")}</Badge> : null}
        </div>
        {description ? <p className="mt-0.5 text-xs text-muted-foreground">{description}</p> : null}
      </div>
      {canManage && !locked ? (
        <ActionDialog
          trigger={
            <button
              type="button"
              role="switch"
              aria-checked={value}
              aria-label={label}
              className={cn("relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors", value ? "border-primary bg-primary" : "bg-muted")}
            >
              <span className={cn("inline-block size-4 rounded-full bg-surface shadow transition-transform", value ? "translate-x-4 rtl:-translate-x-4" : "translate-x-0.5 rtl:-translate-x-0.5")} />
            </button>
          }
          title={`${label}: ${next ? t("admin.controls.on") : t("admin.controls.off")}`}
          description={description}
          confirmLabel={next ? t("admin.controls.turnOn") : t("admin.controls.turnOff")}
          phrase={critical && next !== normal ? controlKey : undefined}
          danger={critical && next !== normal}
          onConfirm={(reason, confirm) => run(CONTROLS_API, "PUT", { key: controlKey, value: next, reason, confirm })}
        />
      ) : (
        <Badge tone={value ? "success" : "neutral"}>{value ? t("admin.controls.on") : t("admin.controls.off")}</Badge>
      )}
    </div>
  );
}

/** Pick a subset of options (disabled modules, models, roles, integrations). */
export function ControlListEditor({
  controlKey,
  value,
  options,
  canManage,
  label,
  description,
  optionLabel,
  allowCustom,
  tone = "danger",
}: {
  controlKey: string;
  value: string[];
  options: string[];
  canManage: boolean;
  label: string;
  description?: string;
  optionLabel?: Record<string, string>;
  allowCustom?: boolean;
  tone?: "danger" | "accent";
}) {
  const { t } = useI18n();
  const run = useAdminAction();
  const [picked, setPicked] = useState<string[]>(value);
  const [custom, setCustom] = useState("");
  const all = [...new Set([...options, ...value, ...picked])];
  return (
    <div className="flex items-start gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{label}</div>
        {description ? <p className="mt-0.5 text-xs text-muted-foreground">{description}</p> : null}
        <div className="mt-1.5 flex flex-wrap gap-1">
          {value.length ? value.map((v) => <Badge key={v} tone={tone}>{optionLabel?.[v] ?? v}</Badge>) : <span className="text-xs text-muted-foreground">{t("admin.controls.none")}</span>}
        </div>
      </div>
      {canManage ? (
        <ActionDialog
          trigger={
            <Button size="sm" variant="secondary" onClick={() => setPicked(value)}>
              {t("admin.common.edit")}
            </Button>
          }
          title={label}
          description={description}
          confirmLabel={t("common.save")}
          onConfirm={(reason) => run(CONTROLS_API, "PUT", { key: controlKey, value: picked, reason })}
        >
          <fieldset className="grid max-h-64 grid-cols-1 gap-1 overflow-y-auto rounded-md border p-2 sm:grid-cols-2">
            <legend className="sr-only">{label}</legend>
            {all.map((o) => (
              <label key={o} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={picked.includes(o)} onChange={(e) => setPicked((p) => (e.target.checked ? [...p, o] : p.filter((x) => x !== o)))} />
                <span className="truncate">{optionLabel?.[o] ?? o}</span>
              </label>
            ))}
          </fieldset>
          {allowCustom ? (
            <div className="flex gap-2">
              <Input value={custom} onChange={(e) => setCustom(e.target.value)} placeholder={t("admin.controls.addValue")} aria-label={t("admin.controls.addValue")} maxLength={120} />
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  const v = custom.trim().toLowerCase();
                  if (v && !picked.includes(v)) setPicked((p) => [...p, v]);
                  setCustom("");
                }}
              >
                {t("admin.common.add")}
              </Button>
            </div>
          ) : null}
        </ActionDialog>
      ) : null}
    </div>
  );
}

/** Edit a single value: number (empty = no limit), text, one-per-line list, or a select. */
export function ControlValueEditor({
  controlKey,
  value,
  kind,
  canManage,
  label,
  description,
  choices,
  display,
}: {
  controlKey: string;
  value: string | number | null | string[];
  kind: "number" | "text" | "lines" | "select" | "nullableText";
  canManage: boolean;
  label: string;
  description?: string;
  choices?: { value: string; label: string }[];
  display?: string;
}) {
  const { t } = useI18n();
  const run = useAdminAction();
  const initial = Array.isArray(value) ? value.join("\n") : value === null ? "" : String(value);
  const [draft, setDraft] = useState(initial);
  const parse = () => {
    if (kind === "number") return draft.trim() === "" ? null : Number(draft);
    if (kind === "lines") return draft.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
    if (kind === "nullableText") return draft.trim() === "" ? null : draft.trim();
    return draft;
  };
  return (
    <div className="flex items-start gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{label}</div>
        {description ? <p className="mt-0.5 text-xs text-muted-foreground">{description}</p> : null}
        <div className="mt-1 text-sm break-words">{display ?? (initial ? <span className="font-mono text-xs">{initial.replace(/\n/g, ", ")}</span> : <span className="text-xs text-muted-foreground">{t("admin.controls.notSet")}</span>)}</div>
      </div>
      {canManage ? (
        <ActionDialog
          trigger={
            <Button size="sm" variant="secondary" onClick={() => setDraft(initial)}>
              {t("admin.common.edit")}
            </Button>
          }
          title={label}
          description={description}
          confirmLabel={t("common.save")}
          onConfirm={(reason) => run(CONTROLS_API, "PUT", { key: controlKey, value: parse(), reason })}
        >
          <Field label={label} htmlFor={`v-${controlKey}`} hint={kind === "number" ? t("admin.controls.emptyNoLimit") : kind === "lines" ? t("admin.controls.onePerLine") : undefined}>
            {kind === "select" ? (
              <Select id={`v-${controlKey}`} value={draft} onChange={(e) => setDraft(e.target.value)}>
                {choices?.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </Select>
            ) : kind === "lines" ? (
              <Textarea id={`v-${controlKey}`} value={draft} onChange={(e) => setDraft(e.target.value)} className="font-mono text-xs" />
            ) : (
              <Input id={`v-${controlKey}`} type={kind === "number" ? "number" : "text"} min={kind === "number" ? 0 : undefined} value={draft} onChange={(e) => setDraft(e.target.value)} />
            )}
          </Field>
        </ActionDialog>
      ) : null}
    </div>
  );
}

/** Emergency lockdown: start (typed LOCKDOWN) or end with one click (restores the previous switch values). */
export function LockdownControl({ active, canManage }: { active: boolean; canManage: boolean }) {
  const { t } = useI18n();
  const run = useAdminAction();
  if (!canManage) return null;
  return active ? (
    <ActionDialog
      trigger={<Button>{t("admin.controls.lockdown.end")}</Button>}
      title={t("admin.controls.lockdown.end")}
      description={t("admin.controls.lockdown.endHint")}
      confirmLabel={t("admin.controls.lockdown.end")}
      onConfirm={(reason) => run(`${CONTROLS_API}/lockdown`, "DELETE", { reason })}
    />
  ) : (
    <ActionDialog
      trigger={<Button variant="danger">{t("admin.controls.lockdown.start")}</Button>}
      title={t("admin.controls.lockdown.start")}
      description={t("admin.controls.lockdown.startHint")}
      confirmLabel={t("admin.controls.lockdown.start")}
      phrase="LOCKDOWN"
      danger
      onConfirm={(reason, confirm) => run(`${CONTROLS_API}/lockdown`, "POST", { reason, confirm })}
    />
  );
}

/** Toggle one member of a "disabled" list (e.g. one AI role or model) — saves the whole list. */
export function ListMemberToggle({ controlKey, list, member, canManage, label }: { controlKey: string; list: string[]; member: string; canManage: boolean; label: string }) {
  const { t } = useI18n();
  const run = useAdminAction();
  const disabled = list.includes(member);
  if (!canManage) return <Badge tone={disabled ? "danger" : "success"}>{disabled ? t("admin.controls.disabled") : t("admin.controls.enabled")}</Badge>;
  return (
    <ActionDialog
      trigger={
        <Button size="sm" variant={disabled ? "default" : "secondary"}>
          {disabled ? t("admin.controls.enable") : t("admin.controls.disable")}
        </Button>
      }
      title={`${disabled ? t("admin.controls.enable") : t("admin.controls.disable")}: ${label}`}
      confirmLabel={disabled ? t("admin.controls.enable") : t("admin.controls.disable")}
      onConfirm={(reason) => run(CONTROLS_API, "PUT", { key: controlKey, value: disabled ? list.filter((x) => x !== member) : [...list, member], reason })}
    />
  );
}
