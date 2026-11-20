"use client";

import { useState, type ReactNode } from "react";
import { Lock } from "lucide-react";
import { LiveDot } from "@/components/motion/live-dot";
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

/**
 * Large kill-switch card: what the switch does in plain language, a status light, and what flipping it will do.
 * Same API call and typed-confirmation rule as ControlSwitch (the server enforces both).
 */
export function KillSwitchCard({
  controlKey,
  value,
  normal,
  critical,
  canManage,
  locked,
  label,
  icon,
  statusText,
  consequence,
}: {
  controlKey: string;
  value: boolean;
  normal: boolean;
  critical?: boolean;
  canManage: boolean;
  locked?: boolean;
  label: string;
  icon?: ReactNode;
  /** What is happening right now, in plain words. */
  statusText: string;
  /** What flipping the switch will do. */
  consequence: string;
}) {
  const { t } = useI18n();
  const run = useAdminAction();
  const next = !value;
  const abnormal = value !== normal;
  const dangerous = !!critical && next !== normal;
  const tone = abnormal ? (critical ? "danger" : "warning") : "success";
  const toggle = (
    <button
      type="button"
      role="switch"
      aria-checked={value}
      aria-label={label}
      disabled={!canManage || locked}
      className={cn(
        "relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-60",
        value ? "border-primary bg-primary" : "border-border-strong bg-muted",
      )}
    >
      <span className={cn("inline-block size-5 rounded-full bg-surface shadow-elev-2 transition-transform duration-300 ease-[var(--ease-spring)]", value ? "translate-x-6 rtl:-translate-x-6" : "translate-x-1 rtl:-translate-x-1")} />
    </button>
  );
  return (
    <article
      className={cn(
        "hover-lift relative flex flex-col gap-3 overflow-hidden rounded-xl border bg-surface p-4 shadow-elev-1",
        abnormal && (critical ? "border-danger/45 bg-danger/5" : "border-warning/45 bg-warning/5"),
      )}
    >
      <div className="flex items-start gap-3">
        {icon ? (
          <span aria-hidden className={cn("grid size-10 shrink-0 place-items-center rounded-lg [&_svg]:size-5", abnormal ? (critical ? "bg-danger/12 text-danger" : "bg-warning/12 text-warning") : "bg-accent text-accent-foreground")}>
            {icon}
          </span>
        ) : null}
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold">{label}</h3>
          <p className="mt-1 flex items-center gap-1.5 text-xs font-medium">
            <LiveDot tone={tone} pulse={abnormal} />
            <span className={abnormal ? (critical ? "text-danger" : "text-warning") : "text-success"}>{abnormal ? t("admin.controls.stateChanged") : t("admin.controls.stateNormal")}</span>
            <span className="text-muted-foreground">· {value ? t("admin.controls.on") : t("admin.controls.off")}</span>
          </p>
        </div>
        {canManage && !locked ? (
          <ActionDialog
            trigger={toggle}
            title={`${label}: ${next ? t("admin.controls.on") : t("admin.controls.off")}`}
            description={consequence}
            confirmLabel={next ? t("admin.controls.turnOn") : t("admin.controls.turnOff")}
            phrase={dangerous ? controlKey : undefined}
            danger={dangerous}
            onConfirm={(reason, confirm) => run(CONTROLS_API, "PUT", { key: controlKey, value: next, reason, confirm })}
          />
        ) : (
          toggle
        )}
      </div>
      <p className="text-sm">{statusText}</p>
      <div className="mt-auto rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{t("admin.controls.ifYouFlip")}</span> {consequence}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {critical ? <Badge tone="danger">{t("admin.controls.critical")}</Badge> : null}
        {locked ? (
          <Badge tone="warning">
            <Lock className="size-3" aria-hidden />
            {t("admin.controls.lockedByLockdown")}
          </Badge>
        ) : null}
        {!canManage ? <Badge>{t("admin.controls.readOnly")}</Badge> : null}
      </div>
    </article>
  );
}
