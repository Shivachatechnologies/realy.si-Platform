"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select } from "@/components/ui/input";
import { FormError } from "@/components/form-error";
import { useT } from "@/i18n/client";
import { api } from "@/lib/api-client";
import { ActionButton, PeoplePicker, useAction, type Person } from "@/components/comms/client";
import { PRIORITIES } from "./ticket-forms";

interface Option {
  id: string;
  name: string;
}

export function SettingsToggles({ base, settings }: { base: string; settings: { helpCenterEnabled: boolean; supportFormEnabled: boolean; aiTriageEnabled: boolean; aiFirstResponseEnabled: boolean; aiSlaEscalationEnabled: boolean } }) {
  const t = useT();
  const { busy, error, run } = useAction();
  return (
    <div className="grid gap-2">
      {(["helpCenterEnabled", "supportFormEnabled", "aiTriageEnabled", "aiFirstResponseEnabled", "aiSlaEscalationEnabled"] as const).map((k) => (
        <label key={k} className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1" checked={settings[k]} disabled={busy} onChange={(e) => void run(() => api(`${base}/support/settings`, { method: "PATCH", body: { [k]: e.target.checked } }))} />
          <span>
            {t(`support.settings.toggles.${k}`)}
            <span className="block text-xs text-muted-foreground">{t(`support.settings.toggles.${k}Hint`)}</span>
          </span>
        </label>
      ))}
      <FormError error={error} />
    </div>
  );
}

export interface CategoryRow {
  id: string;
  name: string;
  description: string | null;
  keywords: string[];
  defaultPriority: string | null;
  count: number;
}

function CategoryForm({ base, initial, onDone }: { base: string; initial?: CategoryRow; onDone?: () => void }) {
  const t = useT();
  const [f, setF] = useState({ name: initial?.name ?? "", keywords: initial?.keywords.join(", ") ?? "", defaultPriority: initial?.defaultPriority ?? "" });
  const { busy, error, run } = useAction();
  return (
    <form
      className="grid gap-2 sm:grid-cols-[10rem_minmax(0,1fr)_9rem_auto]"
      onSubmit={(e) => {
        e.preventDefault();
        const body = { name: f.name, keywords: f.keywords.split(",").map((x) => x.trim()).filter((x) => x.length >= 2), defaultPriority: f.defaultPriority || null };
        void run(
          () => (initial ? api(`${base}/support/categories/${initial.id}`, { method: "PATCH", body }) : api(`${base}/support/categories`, { body })),
          () => {
            if (!initial) setF({ name: "", keywords: "", defaultPriority: "" });
            onDone?.();
          },
        );
      }}
    >
      <Input required maxLength={100} value={f.name} placeholder={t("support.settings.categoryName")} aria-label={t("support.settings.categoryName")} onChange={(e) => setF({ ...f, name: e.target.value })} />
      <Input value={f.keywords} placeholder={t("support.settings.keywords")} aria-label={t("support.settings.keywords")} onChange={(e) => setF({ ...f, keywords: e.target.value })} />
      <Select value={f.defaultPriority} aria-label={t("support.settings.defaultPriority")} onChange={(e) => setF({ ...f, defaultPriority: e.target.value })}>
        <option value="">{t("support.settings.noDefaultPriority")}</option>
        {PRIORITIES.map((p) => (
          <option key={p} value={p}>
            {t(`support.priorities.${p}`)}
          </option>
        ))}
      </Select>
      <Button type="submit" size="sm" disabled={busy || !f.name.trim()}>
        {initial ? t("common.save") : <Plus aria-label={t("support.settings.addCategory")} />}
      </Button>
      <div className="sm:col-span-4">
        <FormError error={error} />
      </div>
    </form>
  );
}

export function CategoriesManager({ base, categories }: { base: string; categories: CategoryRow[] }) {
  const t = useT();
  const [editing, setEditing] = useState<string | null>(null);
  return (
    <div className="grid gap-3">
      <ul className="grid divide-y">
        {categories.map((c) => (
          <li key={c.id} className="grid gap-1 py-2 text-sm">
            {editing === c.id ? (
              <CategoryForm base={base} initial={c} onDone={() => setEditing(null)} />
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{c.name}</span>
                <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{c.keywords.join(", ") || t("support.settings.noKeywords")}</span>
                {c.defaultPriority ? <span className="text-xs">{t(`support.priorities.${c.defaultPriority}`)}</span> : null}
                <span className="text-xs text-muted-foreground">{t("support.settings.ticketsCount", { count: c.count })}</span>
                <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(c.id)}>
                  {t("communication.edit")}
                </Button>
                <ActionButton path={`${base}/support/categories/${c.id}`} method="DELETE" variant="ghost" confirm={t("support.settings.confirmArchiveCategory")}>
                  {t("communication.archive")}
                </ActionButton>
              </div>
            )}
          </li>
        ))}
        {!categories.length ? <li className="py-2 text-sm text-muted-foreground">{t("support.settings.noCategories")}</li> : null}
      </ul>
      <CategoryForm base={base} />
    </div>
  );
}

type Targets = Record<(typeof PRIORITIES)[number], { firstResponseMinutes: number; resolutionMinutes: number }>;
const DEFAULT_TARGETS: Targets = {
  URGENT: { firstResponseMinutes: 60, resolutionMinutes: 8 * 60 },
  HIGH: { firstResponseMinutes: 4 * 60, resolutionMinutes: 24 * 60 },
  NORMAL: { firstResponseMinutes: 8 * 60, resolutionMinutes: 72 * 60 },
  LOW: { firstResponseMinutes: 24 * 60, resolutionMinutes: 7 * 24 * 60 },
};

export interface PolicyRow {
  id: string;
  name: string;
  isDefault: boolean;
  businessHoursOnly: boolean;
  businessStartHour: number;
  businessEndHour: number;
  businessDays: number[];
  targets: { priority: (typeof PRIORITIES)[number]; firstResponseMinutes: number; resolutionMinutes: number }[];
}

export function SlaPolicyForm({ base, initial, onDone }: { base: string; initial?: PolicyRow; onDone?: () => void }) {
  const t = useT();
  const initTargets = { ...DEFAULT_TARGETS };
  for (const x of initial?.targets ?? []) initTargets[x.priority] = { firstResponseMinutes: x.firstResponseMinutes, resolutionMinutes: x.resolutionMinutes };
  // Edited in hours for readability.
  const [f, setF] = useState({
    name: initial?.name ?? "",
    isDefault: initial?.isDefault ?? false,
    businessHoursOnly: initial?.businessHoursOnly ?? false,
    businessStartHour: initial?.businessStartHour ?? 9,
    businessEndHour: initial?.businessEndHour ?? 17,
    businessDays: initial?.businessDays ?? [1, 2, 3, 4, 5],
    targets: Object.fromEntries(PRIORITIES.map((p) => [p, { first: String(initTargets[p].firstResponseMinutes / 60), resolution: String(initTargets[p].resolutionMinutes / 60) }])) as Record<(typeof PRIORITIES)[number], { first: string; resolution: string }>,
  });
  const { busy, error, run } = useAction();
  const minutes = (h: string) => Math.max(1, Math.round(Number(h) * 60) || 60);
  return (
    <form
      className="grid gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        const targets = Object.fromEntries(PRIORITIES.map((p) => [p, { firstResponseMinutes: minutes(f.targets[p].first), resolutionMinutes: minutes(f.targets[p].resolution) }]));
        const body = { name: f.name, isDefault: f.isDefault, businessHoursOnly: f.businessHoursOnly, businessStartHour: f.businessStartHour, businessEndHour: f.businessEndHour, businessDays: f.businessDays, targets };
        void run(
          () => (initial ? api(`${base}/support/sla-policies/${initial.id}`, { method: "PATCH", body }) : api(`${base}/support/sla-policies`, { body })),
          () => onDone?.(),
        );
      }}
    >
      <div className="grid gap-2 sm:grid-cols-2">
        <Input required maxLength={100} value={f.name} placeholder={t("support.settings.policyName")} aria-label={t("support.settings.policyName")} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={f.isDefault} onChange={(e) => setF({ ...f, isDefault: e.target.checked })} />
          {t("support.settings.defaultPolicy")}
        </label>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs text-muted-foreground">
            <th className="py-1 text-start font-medium">{t("support.ticket.priority")}</th>
            <th className="py-1 text-start font-medium">{t("support.settings.firstResponseHours")}</th>
            <th className="py-1 text-start font-medium">{t("support.settings.resolutionHours")}</th>
          </tr>
        </thead>
        <tbody>
          {PRIORITIES.map((p) => (
            <tr key={p}>
              <td className="py-1 pe-2">{t(`support.priorities.${p}`)}</td>
              <td className="py-1 pe-2">
                <Input type="number" min={0.1} step={0.1} required className="h-8" value={f.targets[p].first} aria-label={`${t(`support.priorities.${p}`)} ${t("support.settings.firstResponseHours")}`} onChange={(e) => setF({ ...f, targets: { ...f.targets, [p]: { ...f.targets[p], first: e.target.value } } })} />
              </td>
              <td className="py-1">
                <Input type="number" min={0.1} step={0.1} required className="h-8" value={f.targets[p].resolution} aria-label={`${t(`support.priorities.${p}`)} ${t("support.settings.resolutionHours")}`} onChange={(e) => setF({ ...f, targets: { ...f.targets, [p]: { ...f.targets[p], resolution: e.target.value } } })} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={f.businessHoursOnly} onChange={(e) => setF({ ...f, businessHoursOnly: e.target.checked })} />
        {t("support.settings.businessHoursOnly")}
      </label>
      {f.businessHoursOnly ? (
        <div className="grid gap-2 sm:grid-cols-[7rem_7rem_minmax(0,1fr)]">
          <Field label={t("support.settings.opens")} htmlFor="sla-open">
            <Input id="sla-open" type="number" min={0} max={23} value={f.businessStartHour} onChange={(e) => setF({ ...f, businessStartHour: Number(e.target.value) })} />
          </Field>
          <Field label={t("support.settings.closes")} htmlFor="sla-close">
            <Input id="sla-close" type="number" min={1} max={24} value={f.businessEndHour} onChange={(e) => setF({ ...f, businessEndHour: Number(e.target.value) })} />
          </Field>
          <fieldset className="grid gap-1">
            <legend className="text-sm font-medium">{t("support.settings.businessDays")}</legend>
            <div className="flex flex-wrap gap-2 text-sm">
              {[1, 2, 3, 4, 5, 6, 7].map((d) => (
                <label key={d} className="flex items-center gap-1">
                  <input type="checkbox" checked={f.businessDays.includes(d)} onChange={(e) => setF({ ...f, businessDays: e.target.checked ? [...f.businessDays, d] : f.businessDays.filter((x) => x !== d) })} />
                  {t(`support.settings.weekdays.${d}`)}
                </label>
              ))}
            </div>
          </fieldset>
        </div>
      ) : null}
      <FormError error={error} />
      <div>
        <Button type="submit" size="sm" disabled={busy || !f.name.trim() || (f.businessHoursOnly && !f.businessDays.length)}>
          {initial ? t("common.save") : t("support.settings.addPolicy")}
        </Button>
      </div>
    </form>
  );
}

export function PolicyRowView({ base, policy }: { base: string; policy: PolicyRow }) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const fmt = (m: number) => (m % 60 ? `${(m / 60).toFixed(1)}h` : `${m / 60}h`);
  return (
    <li className="grid gap-2 py-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{policy.name}</span>
        {policy.isDefault ? <span className="rounded-sm bg-accent px-1.5 text-xs">{t("support.settings.defaultPolicy")}</span> : null}
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          {PRIORITIES.map((p) => {
            const x = policy.targets.find((y) => y.priority === p);
            return x ? `${t(`support.priorities.${p}`)} ${fmt(x.firstResponseMinutes)}/${fmt(x.resolutionMinutes)}` : null;
          })
            .filter(Boolean)
            .join(" · ")}
          {policy.businessHoursOnly ? ` · ${t("support.settings.businessHoursShort", { from: policy.businessStartHour, to: policy.businessEndHour })}` : ""}
        </span>
        <Button type="button" size="sm" variant="ghost" onClick={() => setEditing((e) => !e)}>
          {editing ? t("common.cancel") : t("communication.edit")}
        </Button>
        <ActionButton path={`${base}/support/sla-policies/${policy.id}`} method="DELETE" variant="ghost" confirm={t("communication.confirmDelete")}>
          {t("communication.delete")}
        </ActionButton>
      </div>
      {editing ? <SlaPolicyForm base={base} initial={policy} onDone={() => setEditing(false)} /> : null}
    </li>
  );
}

export function AssignmentRuleForm({ base, agents, categories }: { base: string; agents: Person[]; categories: Option[] }) {
  const t = useT();
  const empty = { name: "", strategy: "ROUND_ROBIN" as "ROUND_ROBIN" | "BY_CATEGORY", categoryId: "", assigneeIds: [] as string[], position: 0 };
  const [f, setF] = useState(empty);
  const { busy, error, run } = useAction();
  return (
    <form
      className="grid gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        void run(() => api(`${base}/support/assignment-rules`, { body: { ...f, categoryId: f.categoryId || null } }), () => setF(empty));
      }}
    >
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_10rem_10rem_5rem]">
        <Input required maxLength={100} value={f.name} placeholder={t("support.settings.ruleName")} aria-label={t("support.settings.ruleName")} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <Select value={f.strategy} aria-label={t("support.settings.strategy")} onChange={(e) => setF({ ...f, strategy: e.target.value as typeof f.strategy })}>
          <option value="ROUND_ROBIN">{t("support.settings.strategies.ROUND_ROBIN")}</option>
          <option value="BY_CATEGORY">{t("support.settings.strategies.BY_CATEGORY")}</option>
        </Select>
        <Select value={f.categoryId} disabled={f.strategy !== "BY_CATEGORY"} aria-label={t("support.ticket.category")} onChange={(e) => setF({ ...f, categoryId: e.target.value })}>
          <option value="">{t("support.filters.anyCategory")}</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
        <Input type="number" min={0} max={1000} value={f.position} aria-label={t("support.settings.order")} title={t("support.settings.order")} onChange={(e) => setF({ ...f, position: Number(e.target.value) })} />
      </div>
      <PeoplePicker people={agents} value={f.assigneeIds} onChange={(assigneeIds) => setF({ ...f, assigneeIds })} />
      <FormError error={error} />
      <div>
        <Button type="submit" size="sm" disabled={busy || !f.name.trim() || !f.assigneeIds.length || (f.strategy === "BY_CATEGORY" && !f.categoryId)}>
          {t("support.settings.addRule")}
        </Button>
      </div>
    </form>
  );
}

export function EscalationRuleForm({ base, agents }: { base: string; agents: Person[] }) {
  const t = useT();
  const empty = { name: "", trigger: "FIRST_RESPONSE_BREACH" as "FIRST_RESPONSE_BREACH" | "RESOLUTION_BREACH", raisePriority: true, reassignToId: "", notifyManagers: true };
  const [f, setF] = useState(empty);
  const { busy, error, run } = useAction();
  return (
    <form
      className="grid gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        void run(() => api(`${base}/support/escalation-rules`, { body: { ...f, reassignToId: f.reassignToId || null } }), () => setF(empty));
      }}
    >
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_13rem_12rem]">
        <Input required maxLength={100} value={f.name} placeholder={t("support.settings.ruleName")} aria-label={t("support.settings.ruleName")} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <Select value={f.trigger} aria-label={t("support.settings.trigger")} onChange={(e) => setF({ ...f, trigger: e.target.value as typeof f.trigger })}>
          <option value="FIRST_RESPONSE_BREACH">{t("support.settings.triggers.FIRST_RESPONSE_BREACH")}</option>
          <option value="RESOLUTION_BREACH">{t("support.settings.triggers.RESOLUTION_BREACH")}</option>
        </Select>
        <Select value={f.reassignToId} aria-label={t("support.settings.reassignTo")} onChange={(e) => setF({ ...f, reassignToId: e.target.value })}>
          <option value="">{t("support.settings.noReassign")}</option>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>
              {t("support.settings.reassignToName", { name: a.name })}
            </option>
          ))}
        </Select>
      </div>
      <div className="flex flex-wrap gap-4 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={f.raisePriority} onChange={(e) => setF({ ...f, raisePriority: e.target.checked })} />
          {t("support.settings.raisePriority")}
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={f.notifyManagers} onChange={(e) => setF({ ...f, notifyManagers: e.target.checked })} />
          {t("support.settings.notifyManagers")}
        </label>
      </div>
      <FormError error={error} />
      <div>
        <Button type="submit" size="sm" disabled={busy || !f.name.trim()}>
          {t("support.settings.addRule")}
        </Button>
      </div>
    </form>
  );
}

/** Toggle a rule active / inactive (PATCH with its full current values). */
export function RuleActiveToggle({ path, rule }: { path: string; rule: Record<string, unknown> & { active: boolean } }) {
  const t = useT();
  const { busy, error, run } = useAction();
  return (
    <span className="inline-grid">
      <label className="flex items-center gap-1 text-xs">
        <input type="checkbox" checked={rule.active} disabled={busy} onChange={(e) => void run(() => api(path, { method: "PATCH", body: { ...rule, active: e.target.checked } }))} />
        {t("common.enabled")}
      </label>
      <FormError error={error} />
    </span>
  );
}
