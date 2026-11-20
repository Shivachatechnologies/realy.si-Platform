"use client";

import { useState, type FormEvent } from "react";
import { ArrowDown, ArrowUp, Plus, Star } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select } from "@/components/ui/input";
import { FormError } from "@/components/form-error";
import { useT } from "@/i18n/client";
import { api } from "@/lib/api-client";
import { ActionButton, useAction, type Owner } from "./kit";

/** CRM settings editors: pipelines & stages, lead sources, custom fields, assignment rules, stage rules. */

const STAGE_TYPES = ["OPEN", "WON", "LOST"] as const;

export interface PipelineRow {
  id: string;
  name: string;
  isDefault: boolean;
  staleDays: number;
  stages: { id: string; name: string; probability: number; type: (typeof STAGE_TYPES)[number] }[];
}

function StageRow({ base, stage, first, last, onMove }: { base: string; stage: PipelineRow["stages"][number]; first: boolean; last: boolean; onMove: (dir: -1 | 1) => void }) {
  const t = useT();
  const [f, setF] = useState({ name: stage.name, probability: String(stage.probability), type: stage.type });
  const { busy, error, run } = useAction();
  const dirty = f.name !== stage.name || f.probability !== String(stage.probability) || f.type !== stage.type;
  return (
    <li className="grid gap-1">
      <form
        className="grid grid-cols-[auto_minmax(0,1fr)_5rem_7rem_auto_auto] items-center gap-1"
        onSubmit={(e) => {
          e.preventDefault();
          void run(() => api(`${base}/crm/stages/${stage.id}`, { method: "PATCH", body: { name: f.name, probability: Number(f.probability), type: f.type } }));
        }}
      >
        <span className="flex flex-col">
          <button type="button" className="text-muted-foreground disabled:opacity-30" disabled={first || busy} aria-label={t("crm.settings.moveUp")} onClick={() => onMove(-1)}>
            <ArrowUp className="size-3.5" />
          </button>
          <button type="button" className="text-muted-foreground disabled:opacity-30" disabled={last || busy} aria-label={t("crm.settings.moveDown")} onClick={() => onMove(1)}>
            <ArrowDown className="size-3.5" />
          </button>
        </span>
        <Input aria-label={t("crm.settings.stageName")} className="h-8 text-xs" value={f.name} maxLength={100} required onChange={(e) => setF((p) => ({ ...p, name: e.target.value }))} />
        <Input aria-label={t("crm.probability")} className="h-8 text-xs" type="number" min={0} max={100} value={f.probability} onChange={(e) => setF((p) => ({ ...p, probability: e.target.value }))} />
        <Select aria-label={t("crm.fields.type")} className="h-8 text-xs" value={f.type} onChange={(e) => setF((p) => ({ ...p, type: e.target.value as (typeof STAGE_TYPES)[number] }))}>
          {STAGE_TYPES.map((x) => (
            <option key={x} value={x}>
              {t(`crm.stageTypes.${x}`)}
            </option>
          ))}
        </Select>
        <Button type="submit" size="sm" variant="secondary" disabled={busy || !dirty}>
          {t("common.save")}
        </Button>
        <ActionButton url={`${base}/crm/stages/${stage.id}`} method="DELETE" size="icon" icon="trash" label={t("crm.archive")} confirm={t("crm.settings.archiveStageConfirm")} />
      </form>
      <FormError error={error} />
    </li>
  );
}

function PipelineCard({ base, p }: { base: string; p: PipelineRow }) {
  const t = useT();
  const [name, setName] = useState(p.name);
  const [staleDays, setStaleDays] = useState(String(p.staleDays));
  const [stage, setStage] = useState({ name: "", probability: "50", type: "OPEN" as (typeof STAGE_TYPES)[number] });
  const { busy, error, run } = useAction();
  const reorder = (i: number, dir: -1 | 1) => {
    const ids = p.stages.map((s) => s.id);
    const j = i + dir;
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    void run(() => api(`${base}/crm/pipelines/${p.id}/stages/order`, { body: { stageIds: ids } }));
  };
  return (
    <div className="grid gap-3 rounded-md border p-3">
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void run(() => api(`${base}/crm/pipelines/${p.id}`, { method: "PATCH", body: { name, staleDays: Number(staleDays) } }));
        }}
      >
        <Field label={t("crm.settings.pipelineName")} htmlFor={`pn-${p.id}`} className="min-w-48 flex-1">
          <Input id={`pn-${p.id}`} value={name} maxLength={100} required onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label={t("crm.settings.staleDays")} htmlFor={`ps-${p.id}`} className="w-32">
          <Input id={`ps-${p.id}`} type="number" min={1} max={365} value={staleDays} onChange={(e) => setStaleDays(e.target.value)} />
        </Field>
        <Button type="submit" size="sm" variant="secondary" disabled={busy || (name === p.name && staleDays === String(p.staleDays))}>
          {t("common.save")}
        </Button>
        {p.isDefault ? (
          <Badge tone="accent">
            <Star className="size-3" aria-hidden />
            {t("crm.settings.default")}
          </Badge>
        ) : (
          <>
            <ActionButton url={`${base}/crm/pipelines/${p.id}`} method="PATCH" body={{ isDefault: true }} variant="secondary" label={t("crm.settings.makeDefault")} />
            <ActionButton url={`${base}/crm/pipelines/${p.id}`} method="DELETE" icon="archive" label={t("crm.archive")} confirm={t("crm.settings.archivePipelineConfirm")} />
          </>
        )}
      </form>
      <ol className="grid gap-1">
        {p.stages.map((s, i) => (
          <StageRow key={`${s.id}-${s.name}-${s.probability}-${s.type}`} base={base} stage={s} first={i === 0} last={i === p.stages.length - 1} onMove={(dir) => reorder(i, dir)} />
        ))}
      </ol>
      <form
        className="grid grid-cols-[minmax(0,1fr)_5rem_7rem_auto] items-end gap-1"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          void run(
            () => api(`${base}/crm/pipelines/${p.id}/stages`, { body: { name: stage.name, probability: Number(stage.probability), type: stage.type } }),
            () => setStage({ name: "", probability: "50", type: "OPEN" }),
          );
        }}
      >
        <Input aria-label={t("crm.settings.stageName")} className="h-8 text-xs" value={stage.name} maxLength={100} required placeholder={t("crm.settings.newStage")} onChange={(e) => setStage((s) => ({ ...s, name: e.target.value }))} />
        <Input aria-label={t("crm.probability")} className="h-8 text-xs" type="number" min={0} max={100} value={stage.probability} onChange={(e) => setStage((s) => ({ ...s, probability: e.target.value }))} />
        <Select aria-label={t("crm.fields.type")} className="h-8 text-xs" value={stage.type} onChange={(e) => setStage((s) => ({ ...s, type: e.target.value as (typeof STAGE_TYPES)[number] }))}>
          {STAGE_TYPES.map((x) => (
            <option key={x} value={x}>
              {t(`crm.stageTypes.${x}`)}
            </option>
          ))}
        </Select>
        <Button type="submit" size="sm" variant="secondary" disabled={busy || !stage.name.trim()}>
          <Plus aria-hidden />
          {t("crm.settings.addStage")}
        </Button>
      </form>
      <FormError error={error} />
    </div>
  );
}

export function PipelinesEditor({ base, pipelines }: { base: string; pipelines: PipelineRow[] }) {
  const t = useT();
  const [name, setName] = useState("");
  const { busy, error, run } = useAction();
  return (
    <div className="grid gap-3 p-4">
      {pipelines.map((p) => (
        <PipelineCard key={p.id} base={base} p={p} />
      ))}
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void run(() => api(`${base}/crm/pipelines`, { body: { name } }), () => setName(""));
        }}
      >
        <Field label={t("crm.settings.newPipeline")} htmlFor="new-pipeline" hint={t("crm.settings.newPipelineHint")} className="min-w-60 flex-1">
          <Input id="new-pipeline" value={name} maxLength={100} required onChange={(e) => setName(e.target.value)} />
        </Field>
        <Button type="submit" variant="secondary" disabled={busy || !name.trim()}>
          <Plus aria-hidden />
          {t("crm.settings.addPipeline")}
        </Button>
      </form>
      <FormError error={error} />
    </div>
  );
}

/** Generic create form posting to /crm/settings/<kind>. */
function useCreate(base: string, kind: string) {
  const a = useAction();
  return { ...a, create: (body: unknown, after?: () => void) => a.run(() => api(`${base}/crm/settings/${kind}`, { body }), after) };
}

export function SourcesEditor({ base, sources }: { base: string; sources: { id: string; name: string }[] }) {
  const t = useT();
  const [name, setName] = useState("");
  const { busy, error, create } = useCreate(base, "sources");
  return (
    <div className="grid gap-3 p-4">
      <ul className="flex flex-wrap gap-2">
        {sources.map((s) => (
          <li key={s.id} className="inline-flex items-center gap-1 rounded-full border ps-3 text-sm">
            {s.name}
            <ActionButton url={`${base}/crm/settings/sources/${s.id}`} method="DELETE" size="icon" icon="x" label={t("crm.delete")} />
          </li>
        ))}
        {!sources.length ? <li className="text-sm text-muted-foreground">{t("crm.settings.noSources")}</li> : null}
      </ul>
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void create({ name }, () => setName(""));
        }}
      >
        <Input aria-label={t("crm.source")} className="max-w-64" value={name} maxLength={100} required placeholder={t("crm.sourcePlaceholder")} onChange={(e) => setName(e.target.value)} />
        <Button type="submit" variant="secondary" disabled={busy || !name.trim()}>
          <Plus aria-hidden />
          {t("crm.settings.addSource")}
        </Button>
      </form>
      <FormError error={error} />
    </div>
  );
}

const ENTITIES = ["LEAD", "CONTACT", "ACCOUNT", "DEAL"] as const;
const FIELD_TYPES = ["TEXT", "NUMBER", "DATE", "SELECT"] as const;

export function CustomFieldsEditor({ base, fields }: { base: string; fields: { id: string; entity: string; key: string; label: string; type: string; options: string[]; required: boolean }[] }) {
  const t = useT();
  const empty = { entity: "CONTACT", label: "", type: "TEXT", options: "", required: false };
  const [f, setF] = useState(empty);
  const { busy, error, create } = useCreate(base, "custom-fields");
  return (
    <div className="grid gap-3 p-4">
      {fields.length ? (
        <table className="w-full text-sm">
          <thead className="text-xs text-muted-foreground">
            <tr className="border-b">
              <th className="p-2 text-start font-medium">{t("crm.settings.entity")}</th>
              <th className="p-2 text-start font-medium">{t("crm.settings.label")}</th>
              <th className="p-2 text-start font-medium">{t("crm.fields.type")}</th>
              <th className="p-2 text-start font-medium">{t("crm.settings.options")}</th>
              <th className="p-2" />
            </tr>
          </thead>
          <tbody className="divide-y">
            {fields.map((x) => (
              <tr key={x.id}>
                <td className="p-2">{t(`crm.entities.${x.entity}`)}</td>
                <td className="p-2">
                  {x.label}
                  {x.required ? " *" : ""} <span className="font-mono text-xs text-muted-foreground">{x.key}</span>
                </td>
                <td className="p-2">{t(`crm.fieldTypes.${x.type}`)}</td>
                <td className="p-2 text-xs text-muted-foreground">{x.options.join(", ") || "—"}</td>
                <td className="p-2 text-end">
                  <ActionButton url={`${base}/crm/settings/custom-fields/${x.id}`} method="DELETE" size="icon" icon="archive" label={t("crm.archive")} confirm={t("crm.settings.archiveFieldConfirm")} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="text-sm text-muted-foreground">{t("crm.settings.noFields")}</p>
      )}
      <form
        className="grid gap-2 sm:grid-cols-[9rem_minmax(0,1fr)_8rem_minmax(0,1fr)_auto_auto] sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          void create({ entity: f.entity, label: f.label, type: f.type, required: f.required, options: f.type === "SELECT" ? f.options.split(",").map((s) => s.trim()).filter(Boolean) : [] }, () => setF(empty));
        }}
      >
        <Field label={t("crm.settings.entity")} htmlFor="cf-entity">
          <Select id="cf-entity" value={f.entity} onChange={(e) => setF((p) => ({ ...p, entity: e.target.value }))}>
            {ENTITIES.map((x) => (
              <option key={x} value={x}>
                {t(`crm.entities.${x}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("crm.settings.label")} htmlFor="cf-label">
          <Input id="cf-label" value={f.label} maxLength={100} required onChange={(e) => setF((p) => ({ ...p, label: e.target.value }))} />
        </Field>
        <Field label={t("crm.fields.type")} htmlFor="cf-type">
          <Select id="cf-type" value={f.type} onChange={(e) => setF((p) => ({ ...p, type: e.target.value }))}>
            {FIELD_TYPES.map((x) => (
              <option key={x} value={x}>
                {t(`crm.fieldTypes.${x}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("crm.settings.options")} htmlFor="cf-options" hint={t("crm.settings.optionsHint")}>
          <Input id="cf-options" value={f.options} disabled={f.type !== "SELECT"} maxLength={2000} onChange={(e) => setF((p) => ({ ...p, options: e.target.value }))} />
        </Field>
        <label className="flex items-center gap-2 pb-2 text-sm">
          <input type="checkbox" className="size-4 accent-primary" checked={f.required} onChange={(e) => setF((p) => ({ ...p, required: e.target.checked }))} />
          {t("crm.settings.required")}
        </label>
        <Button type="submit" variant="secondary" disabled={busy || !f.label.trim()}>
          <Plus aria-hidden />
          {t("crm.settings.addField")}
        </Button>
      </form>
      <FormError error={error} />
    </div>
  );
}

export function AssignmentRulesEditor({
  base,
  owners,
  sources,
  rules,
}: {
  base: string;
  owners: Owner[];
  sources: string[];
  rules: { id: string; name: string; strategy: string; ownerIds: string[]; matchSource: string | null; matchTerritory: string | null; active: boolean; assignedCount: number }[];
}) {
  const t = useT();
  const empty = { name: "", strategy: "ROUND_ROBIN", matchSource: "", matchTerritory: "", ownerIds: [] as string[] };
  const [f, setF] = useState(empty);
  const { busy, error, create } = useCreate(base, "assignment-rules");
  const nameOf = (id: string) => owners.find((o) => o.id === id)?.name ?? "—";
  return (
    <div className="grid gap-3 p-4">
      {rules.length ? (
        <ul className="grid divide-y rounded-md border text-sm">
          {rules.map((r, i) => (
            <li key={r.id} className="flex flex-wrap items-center gap-2 p-2">
              <span className="text-xs text-muted-foreground">{i + 1}.</span>
              <span className="font-medium">{r.name}</span>
              <Badge>{t(`crm.settings.strategies.${r.strategy}`)}</Badge>
              <span className="text-xs text-muted-foreground">
                {[r.matchSource ? `${t("crm.source")}: ${r.matchSource}` : null, r.matchTerritory ? `${t("crm.fields.territory")}: ${r.matchTerritory}` : null].filter(Boolean).join(" · ") || t("crm.settings.matchAll")}
              </span>
              <span className="min-w-0 flex-1 truncate text-xs">→ {r.ownerIds.map(nameOf).join(", ")}</span>
              <span className="text-xs text-muted-foreground">{t("crm.settings.assigned", { count: r.assignedCount })}</span>
              <ActionButton url={`${base}/crm/settings/assignment-rules/${r.id}`} method="PATCH" body={{ active: !r.active }} variant="secondary" label={r.active ? t("crm.settings.disable") : t("crm.settings.enable")} />
              <ActionButton url={`${base}/crm/settings/assignment-rules/${r.id}`} method="DELETE" size="icon" icon="trash" label={t("crm.delete")} confirm={t("crm.deleteConfirm")} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">{t("crm.settings.noAssignmentRules")}</p>
      )}
      <form
        className="grid gap-2 sm:grid-cols-4 sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          void create({ ...f, matchSource: f.matchSource || undefined, matchTerritory: f.matchTerritory || undefined, position: rules.length }, () => setF(empty));
        }}
      >
        <Field label={t("crm.settings.ruleName")} htmlFor="ar-name">
          <Input id="ar-name" value={f.name} maxLength={100} required onChange={(e) => setF((p) => ({ ...p, name: e.target.value }))} />
        </Field>
        <Field label={t("crm.settings.strategy")} htmlFor="ar-strategy">
          <Select id="ar-strategy" value={f.strategy} onChange={(e) => setF((p) => ({ ...p, strategy: e.target.value }))}>
            <option value="ROUND_ROBIN">{t("crm.settings.strategies.ROUND_ROBIN")}</option>
            <option value="FIXED">{t("crm.settings.strategies.FIXED")}</option>
          </Select>
        </Field>
        <Field label={t("crm.settings.matchSource")} htmlFor="ar-source" hint={t("crm.settings.matchAnyHint")}>
          <Select id="ar-source" value={f.matchSource} onChange={(e) => setF((p) => ({ ...p, matchSource: e.target.value }))}>
            <option value="">{t("crm.settings.any")}</option>
            {sources.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("crm.settings.matchTerritory")} htmlFor="ar-territory" hint={t("crm.settings.matchAnyHint")}>
          <Input id="ar-territory" value={f.matchTerritory} maxLength={100} onChange={(e) => setF((p) => ({ ...p, matchTerritory: e.target.value }))} />
        </Field>
        <fieldset className="grid gap-1 sm:col-span-4">
          <legend className="text-sm font-medium">{t("crm.settings.ruleOwners")}</legend>
          <div className="flex flex-wrap gap-3">
            {owners.map((o) => (
              <label key={o.id} className="flex items-center gap-1.5 text-sm">
                <input
                  type="checkbox"
                  className="size-4 accent-primary"
                  checked={f.ownerIds.includes(o.id)}
                  onChange={(e) => setF((p) => ({ ...p, ownerIds: e.target.checked ? [...p.ownerIds, o.id] : p.ownerIds.filter((x) => x !== o.id) }))}
                />
                {o.name}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="sm:col-span-4">
          <Button type="submit" variant="secondary" disabled={busy || !f.name.trim() || !f.ownerIds.length}>
            <Plus aria-hidden />
            {t("crm.settings.addRule")}
          </Button>
        </div>
      </form>
      <FormError error={error} />
    </div>
  );
}

export function StageRulesEditor({
  base,
  stages,
  rules,
}: {
  base: string;
  stages: { id: string; label: string }[];
  rules: { id: string; name: string; stageLabel: string; createFollowUp: boolean; followUpDays: number; createWorkTask: boolean; notifyOwner: boolean; active: boolean }[];
}) {
  const t = useT();
  const empty = { stageId: stages[0]?.id ?? "", name: "", createFollowUp: true, followUpDays: "2", followUpNote: "", createWorkTask: false, workTaskTitle: "", notifyOwner: true };
  const [f, setF] = useState(empty);
  const { busy, error, create } = useCreate(base, "stage-rules");
  return (
    <div className="grid gap-3 p-4">
      {rules.length ? (
        <ul className="grid divide-y rounded-md border text-sm">
          {rules.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-2 p-2">
              <span className="font-medium">{r.name}</span>
              <Badge>{r.stageLabel}</Badge>
              <span className="min-w-0 flex-1 text-xs text-muted-foreground">
                {[r.createFollowUp ? t("crm.settings.doFollowUp", { days: r.followUpDays }) : null, r.createWorkTask ? t("crm.settings.doWorkTask") : null, r.notifyOwner ? t("crm.settings.doNotify") : null].filter(Boolean).join(" · ")}
              </span>
              <ActionButton url={`${base}/crm/settings/stage-rules/${r.id}`} method="PATCH" body={{ active: !r.active }} variant="secondary" label={r.active ? t("crm.settings.disable") : t("crm.settings.enable")} />
              <ActionButton url={`${base}/crm/settings/stage-rules/${r.id}`} method="DELETE" size="icon" icon="trash" label={t("crm.delete")} confirm={t("crm.deleteConfirm")} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">{t("crm.settings.noStageRules")}</p>
      )}
      <form
        className="grid gap-2 sm:grid-cols-3 sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          void create({ ...f, followUpDays: Number(f.followUpDays) || 0, followUpNote: f.followUpNote || undefined, workTaskTitle: f.workTaskTitle || undefined }, () => setF(empty));
        }}
      >
        <Field label={t("crm.settings.whenEntering")} htmlFor="sr-stage">
          <Select id="sr-stage" value={f.stageId} onChange={(e) => setF((p) => ({ ...p, stageId: e.target.value }))}>
            {stages.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("crm.settings.ruleName")} htmlFor="sr-name">
          <Input id="sr-name" value={f.name} maxLength={100} required onChange={(e) => setF((p) => ({ ...p, name: e.target.value }))} />
        </Field>
        <label className="flex items-center gap-2 pb-2 text-sm">
          <input type="checkbox" className="size-4 accent-primary" checked={f.notifyOwner} onChange={(e) => setF((p) => ({ ...p, notifyOwner: e.target.checked }))} />
          {t("crm.settings.notifyOwner")}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="size-4 accent-primary" checked={f.createFollowUp} onChange={(e) => setF((p) => ({ ...p, createFollowUp: e.target.checked }))} />
          {t("crm.settings.createFollowUp")}
        </label>
        <Field label={t("crm.settings.followUpDays")} htmlFor="sr-days">
          <Input id="sr-days" type="number" min={0} max={365} disabled={!f.createFollowUp} value={f.followUpDays} onChange={(e) => setF((p) => ({ ...p, followUpDays: e.target.value }))} />
        </Field>
        <Field label={t("crm.followUpNote")} htmlFor="sr-note">
          <Input id="sr-note" disabled={!f.createFollowUp} value={f.followUpNote} maxLength={1000} onChange={(e) => setF((p) => ({ ...p, followUpNote: e.target.value }))} />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="size-4 accent-primary" checked={f.createWorkTask} onChange={(e) => setF((p) => ({ ...p, createWorkTask: e.target.checked }))} />
          {t("crm.settings.createWorkTask")}
        </label>
        <div className="sm:col-span-2">
          <Field label={t("crm.settings.workTaskTitle")} htmlFor="sr-task">
            <Input id="sr-task" disabled={!f.createWorkTask} value={f.workTaskTitle} maxLength={200} onChange={(e) => setF((p) => ({ ...p, workTaskTitle: e.target.value }))} />
          </Field>
        </div>
        <div className="sm:col-span-3">
          <Button type="submit" variant="secondary" disabled={busy || !f.name.trim() || !f.stageId}>
            <Plus aria-hidden />
            {t("crm.settings.addRule")}
          </Button>
        </div>
      </form>
      <FormError error={error} />
    </div>
  );
}
