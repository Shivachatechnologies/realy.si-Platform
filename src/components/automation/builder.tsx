"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp, Plus, Rocket, Save, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { FormError } from "@/components/form-error";
import { useI18n, useT } from "@/i18n/client";
import { api, ApiError } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import {
  ACCOUNT_TYPE_VALUES,
  ACTION_GROUPS,
  APPROVER_MODES,
  ASSIGN_ENTITIES,
  CONDITION_OPS,
  LOAD_ENTITIES,
  LEAD_STAGE_VALUES,
  RECORD_FIELDS,
  STEP_TYPES,
  TRIGGER_EVENTS,
  WORK_PRIORITIES,
  flattenSteps,
  validateDefinition,
  variableSuggestions,
  type Action,
  type ActionKind,
  type Condition,
  type Definition,
  type Step,
  type Trigger,
} from "@/server/modules/automation/definition";
import { eventLabelKey } from "./labels";
import { useAction } from "./use-action";

export interface BuilderOptions {
  users: { id: string; name: string }[];
  profiles: { key: string; name: string }[];
  hooks: { id: string; name: string }[];
  permissions: string[];
  connected: { slack: boolean; custom_api: boolean; email: boolean; microsoft: boolean };
  /** Deal pipeline stages ("Pipeline · Stage"). */
  stages: { id: string; name: string }[];
  /** Project templates: built-in keys and saved template ids. */
  projectTemplates: { key: string; name: string }[];
  /** HR onboarding/offboarding checklist templates. */
  hrTemplates: { id: string; name: string }[];
  aiEmployees: { id: string; name: string }[];
}

const DEFAULT_ACTIONS: Record<ActionKind, Action> = {
  create_lead: { kind: "create_lead", name: "{{event.data.name}}", email: "{{event.data.email}}" },
  create_contact: { kind: "create_contact", firstName: "{{event.data.firstName}}", email: "{{event.data.email}}" },
  create_account: { kind: "create_account", name: "{{event.data.account}}", type: "PROSPECT" },
  create_task: { kind: "create_task", title: "", priority: "MEDIUM", dueInDays: 1 },
  update_lead: { kind: "update_lead", leadId: "{{event.entityId}}" },
  update_record: { kind: "update_record", entity: "lead", recordId: "{{event.entityId}}", field: "stage", value: "" },
  assign_user: { kind: "assign_user", entity: "lead", recordId: "{{event.entityId}}", userId: "" },
  assign_round_robin: { kind: "assign_round_robin", entity: "lead", recordId: "{{event.entityId}}", pool: "users", userIds: [] },
  load_record: { kind: "load_record", entity: "account", recordId: "{{event.data.accountId}}" },
  create_deal: { kind: "create_deal", name: "{{event.data.name}}", ownerId: "{{event.data.ownerId}}" },
  move_deal_stage: { kind: "move_deal_stage", dealId: "{{event.entityId}}", stageId: "" },
  create_project: { kind: "create_project", name: "{{event.data.name}}", template: "", memberIds: [], startInDays: 0 },
  add_project_members: { kind: "add_project_members", projectId: "", userIds: [] },
  start_onboarding: { kind: "start_onboarding", employeeId: "{{event.entityId}}", checklist: "ONBOARDING" },
  create_invoice: { kind: "create_invoice", accountId: "{{event.data.accountId}}", description: "", quantity: "1", unitPrice: "", dueInDays: 14 },
  create_meeting: { kind: "create_meeting", title: "", startInHours: 24, durationMinutes: 30, attendeeIds: [] },
  assign_ai_employee: { kind: "assign_ai_employee", profile: "research_analyst", title: "", instructions: "", wait: false },
  ai_employee_task: { kind: "ai_employee_task", aiEmployeeId: "", title: "", instructions: "", wait: true },
  decompose_goal: { kind: "decompose_goal", objectiveId: "{{event.entityId}}", wait: true },
  notify: { kind: "notify", recipients: "owner", userIds: [], title: "" },
  request_approval: { kind: "request_approval", title: "", approverMode: "users", approverIds: [], escalateToIds: [] },
  generate_ai_content: { kind: "generate_ai_content", profile: "marketing_strategist", title: "", instructions: "", wait: true },
  send_email: { kind: "send_email", to: "{{event.data.email}}", subject: "", body: "" },
  send_slack: { kind: "send_slack", channel: "general", text: "", ifNotConnected: "fail" },
  send_teams: { kind: "send_teams", teamId: "", channelId: "", text: "", ifNotConnected: "fail" },
  http_webhook: { kind: "http_webhook", url: "https://", body: "" },
  custom_api: { kind: "custom_api", method: "POST", path: "/", body: "" },
};

function newStep(type: (typeof STEP_TYPES)[number], ids: Set<string>, kind: ActionKind = "create_task"): Step {
  const prefix = type === "action" ? kind.replace(/^(create|update|send|assign|generate|request|load|start|move|add)_/, "") : type;
  let n = 1;
  while (ids.has(`${prefix}_${n}`)) n++;
  const id = `${prefix}_${n}`.slice(0, 40);
  const cond: Condition = { field: "event.data.status", op: "eq", value: "" };
  switch (type) {
    case "condition":
      return { id, type, match: "all", conditions: [cond] };
    case "branch":
      return { id, type, match: "all", conditions: [cond], then: [], else: [] };
    case "delay":
      return { id, type, amount: 1, unit: "days" };
    case "set_variable":
      return { id, type, name: `var${n}`, value: "" };
    case "action":
      return { id, type, action: structuredClone(DEFAULT_ACTIONS[kind]) };
  }
}

/** Text input with a variable picker that appends {{path}}. */
function TemplateInput({ id, value, onChange, vars, multiline, placeholder, required }: { id: string; value: string; onChange: (v: string) => void; vars: string[]; multiline?: boolean; placeholder?: string; required?: boolean }) {
  const t = useT();
  return (
    <div className="grid gap-1">
      {multiline ? (
        <Textarea id={id} rows={3} value={value} placeholder={placeholder} maxLength={10000} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <Input id={id} value={value} placeholder={placeholder} required={required} maxLength={2000} onChange={(e) => onChange(e.target.value)} />
      )}
      <Select
        className="h-7 w-auto max-w-full text-xs"
        value=""
        aria-label={t("workflows.builder.insertVariable")}
        onChange={(e) => {
          if (e.target.value) onChange(`${value}{{${e.target.value}}}`);
        }}
      >
        <option value="">{t("workflows.builder.insertVariable")}</option>
        {vars.map((v) => (
          <option key={v} value={v}>
            {v}
          </option>
        ))}
      </Select>
    </div>
  );
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A user picker that also accepts a template (e.g. {{event.data.ownerId}}). */
function UserField({ id, value, onChange, users, vars }: { id: string; value: string; onChange: (v: string) => void; users: BuilderOptions["users"]; vars: string[] }) {
  const t = useT();
  const custom = !!value && !(UUID.test(value) && users.some((u) => u.id === value));
  const [mode, setMode] = useState<"pick" | "template">(custom ? "template" : "pick");
  return (
    <div className="grid gap-1">
      {mode === "pick" ? (
        <Select id={id} value={value} onChange={(e) => (e.target.value === "__template" ? setMode("template") : onChange(e.target.value))}>
          <option value="">{t("workflows.builder.nobody")}</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
          <option value="__template">{t("workflows.builder.fromVariable")}</option>
        </Select>
      ) : (
        <>
          <TemplateInput id={id} value={value} onChange={onChange} vars={vars} placeholder="{{event.data.ownerId}}" />
          <button type="button" className="justify-self-start text-xs text-primary hover:underline" onClick={() => setMode("pick")}>
            {t("workflows.builder.pickPerson")}
          </button>
        </>
      )}
    </div>
  );
}

function UserChecklist({ value, onChange, users }: { value: string[]; onChange: (v: string[]) => void; users: BuilderOptions["users"] }) {
  return (
    <div className="grid max-h-40 gap-1 overflow-y-auto rounded-md border p-2 sm:grid-cols-2">
      {users.map((u) => (
        <label key={u.id} className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="size-4" checked={value.includes(u.id)} onChange={() => onChange(value.includes(u.id) ? value.filter((x) => x !== u.id) : [...value, u.id])} />
          <span className="truncate">{u.name}</span>
        </label>
      ))}
    </div>
  );
}

function ConditionsEditor({ idPrefix, conditions, onChange, vars, allowEmpty }: { idPrefix: string; conditions: Condition[]; onChange: (c: Condition[]) => void; vars: string[]; allowEmpty?: boolean }) {
  const t = useT();
  const set = (i: number, patch: Partial<Condition>) => onChange(conditions.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const listId = `${idPrefix}-fields`;
  return (
    <div className="grid gap-2">
      <datalist id={listId}>
        {vars.map((v) => (
          <option key={v} value={v} />
        ))}
      </datalist>
      {conditions.map((c, i) => (
        <div key={i} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_9rem_minmax(0,1fr)_auto]">
          <Input list={listId} value={c.field} aria-label={t("workflows.builder.field")} placeholder="event.data.stage" maxLength={200} onChange={(e) => set(i, { field: e.target.value.trim() })} />
          <Select value={c.op} aria-label={t("workflows.builder.op")} onChange={(e) => set(i, { op: e.target.value as Condition["op"] })}>
            {CONDITION_OPS.map((op) => (
              <option key={op} value={op}>
                {t(`workflows.builder.ops.${op}`)}
              </option>
            ))}
          </Select>
          <Input value={c.value ?? ""} aria-label={t("workflows.builder.value")} disabled={c.op === "exists" || c.op === "not_exists"} maxLength={500} onChange={(e) => set(i, { value: e.target.value })} />
          <Button type="button" size="icon" variant="ghost" aria-label={t("workflows.builder.remove")} disabled={!allowEmpty && conditions.length <= 1} onClick={() => onChange(conditions.filter((_, j) => j !== i))}>
            <Trash2 aria-hidden />
          </Button>
        </div>
      ))}
      <Button type="button" size="sm" variant="ghost" className="justify-self-start" onClick={() => onChange([...conditions, { field: "event.data.", op: "eq", value: "" }])}>
        <Plus aria-hidden />
        {t("workflows.builder.addCondition")}
      </Button>
    </div>
  );
}

function TriggerEditor({ trigger, onChange, opts, vars }: { trigger: Trigger; onChange: (t: Trigger) => void; opts: BuilderOptions; vars: string[] }) {
  const t = useT();
  const setType = (type: Trigger["type"]) => {
    if (type === "event") onChange({ type, event: "lead.created", filters: [] });
    else if (type === "schedule") onChange({ type, schedule: { kind: "daily", time: "09:00" }, filters: [] });
    else if (type === "webhook") onChange({ type, hookId: opts.hooks[0]?.id ?? "", filters: [] });
    else onChange({ type: "manual", filters: [] });
  };
  return (
    <div className="grid gap-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={t("workflows.builder.triggerType")} htmlFor="trigger-type">
          <Select id="trigger-type" value={trigger.type} onChange={(e) => setType(e.target.value as Trigger["type"])}>
            {(["event", "schedule", "webhook", "manual"] as const).map((x) => (
              <option key={x} value={x}>
                {t(`workflows.builder.triggerTypes.${x}`)}
              </option>
            ))}
          </Select>
        </Field>
        {trigger.type === "event" ? (
          <Field label={t("workflows.builder.event")} htmlFor="trigger-event">
            <Select id="trigger-event" value={trigger.event} onChange={(e) => onChange({ ...trigger, event: e.target.value as typeof trigger.event })}>
              {TRIGGER_EVENTS.map((ev) => (
                <option key={ev} value={ev}>
                  {t(eventLabelKey(ev))}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        {trigger.type === "webhook" ? (
          <Field label={t("workflows.builder.hook")} htmlFor="trigger-hook" hint={opts.hooks.length ? undefined : t("workflows.builder.noHooks")}>
            <Select id="trigger-hook" value={trigger.hookId} onChange={(e) => onChange({ ...trigger, hookId: e.target.value })}>
              <option value="">—</option>
              {opts.hooks.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        {trigger.type === "schedule" ? (
          <>
            <Field label={t("workflows.builder.scheduleKind")} htmlFor="schedule-kind">
              <Select
                id="schedule-kind"
                value={trigger.schedule.kind}
                onChange={(e) => {
                  const kind = e.target.value as "interval" | "daily" | "weekly";
                  onChange({ ...trigger, schedule: kind === "interval" ? { kind, minutes: 60 } : kind === "daily" ? { kind, time: "09:00" } : { kind, day: 1, time: "09:00" } });
                }}
              >
                {(["interval", "daily", "weekly"] as const).map((k) => (
                  <option key={k} value={k}>
                    {t(`workflows.builder.scheduleKinds.${k}`)}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="flex gap-2">
              {trigger.schedule.kind === "interval" ? (
                <Field label={t("workflows.builder.everyMinutes")} htmlFor="schedule-minutes" className="flex-1">
                  <Input id="schedule-minutes" type="number" min={15} max={10080} value={trigger.schedule.minutes} onChange={(e) => onChange({ ...trigger, schedule: { kind: "interval", minutes: Number(e.target.value) || 15 } })} />
                </Field>
              ) : (
                <>
                  {trigger.schedule.kind === "weekly" ? (
                    <Field label={t("workflows.builder.day")} htmlFor="schedule-day" className="flex-1">
                      <Select id="schedule-day" value={trigger.schedule.day} onChange={(e) => trigger.schedule.kind === "weekly" && onChange({ ...trigger, schedule: { ...trigger.schedule, day: Number(e.target.value) } })}>
                        {[1, 2, 3, 4, 5, 6, 0].map((d) => (
                          <option key={d} value={d}>
                            {t(`workflows.builder.days.${d}`)}
                          </option>
                        ))}
                      </Select>
                    </Field>
                  ) : null}
                  <Field label={t("workflows.builder.time")} htmlFor="schedule-time" className="flex-1">
                    <Input id="schedule-time" type="time" value={trigger.schedule.time} onChange={(e) => trigger.schedule.kind !== "interval" && onChange({ ...trigger, schedule: { ...trigger.schedule, time: e.target.value } })} />
                  </Field>
                </>
              )}
            </div>
          </>
        ) : null}
      </div>
      {trigger.type === "schedule" ? <p className="text-xs text-muted-foreground">{t("workflows.builder.scheduleHelp")}</p> : null}
      {trigger.type === "manual" ? <p className="text-xs text-muted-foreground">{t("workflows.builder.manualHelp")}</p> : null}
      {trigger.type === "event" || trigger.type === "webhook" ? (
        <div className="grid gap-1">
          <p className="text-sm font-medium">{t("workflows.builder.filters")}</p>
          <p className="text-xs text-muted-foreground">{t("workflows.builder.filtersHelp")}</p>
          <ConditionsEditor idPrefix="trigger" conditions={trigger.filters} vars={vars} allowEmpty onChange={(filters) => onChange({ ...trigger, filters })} />
        </div>
      ) : null}
    </div>
  );
}

function ActionEditor({ step, action, onChange, opts, vars }: { step: string; action: Action; onChange: (a: Action) => void; opts: BuilderOptions; vars: string[] }) {
  const t = useT();
  const id = (f: string) => `${step}-${f}`;
  const L = (f: string) => t(`workflows.builder.fields.${f}`);
  const text = (f: string, opts2: { multiline?: boolean; required?: boolean; placeholder?: string } = {}) => (
    <Field label={L(f)} htmlFor={id(f)} className={opts2.multiline ? "sm:col-span-2" : undefined}>
      <TemplateInput id={id(f)} value={String((action as Record<string, unknown>)[f] ?? "")} onChange={(v) => onChange({ ...action, [f]: v } as Action)} vars={vars} multiline={opts2.multiline} required={opts2.required} placeholder={opts2.placeholder} />
    </Field>
  );
  const user = (f: string) => (
    <Field label={L(f)} htmlFor={id(f)}>
      <UserField id={id(f)} value={String((action as Record<string, unknown>)[f] ?? "")} onChange={(v) => onChange({ ...action, [f]: v } as Action)} users={opts.users} vars={vars} />
    </Field>
  );
  const profile = (a: Extract<Action, { kind: "assign_ai_employee" | "generate_ai_content" }>) => (
    <>
      <Field label={L("profile")} htmlFor={id("profile")}>
        <Select id={id("profile")} value={a.profile} onChange={(e) => onChange({ ...a, profile: e.target.value })}>
          {opts.profiles.map((p) => (
            <option key={p.key} value={p.key}>
              {p.name}
            </option>
          ))}
        </Select>
      </Field>
      {text("title", { required: true })}
      {text("instructions", { multiline: true })}
      <label className="flex items-center gap-2 text-sm sm:col-span-2">
        <input type="checkbox" className="size-4" checked={a.wait} onChange={(e) => onChange({ ...a, wait: e.target.checked })} />
        {L("wait")}
      </label>
    </>
  );
  const entity = (a: Extract<Action, { kind: "update_record" | "assign_user" | "assign_round_robin" }>) => (
    <Field label={L("entity")} htmlFor={id("entity")}>
      <Select id={id("entity")} value={a.entity} onChange={(e) => onChange({ ...a, entity: e.target.value as "lead", ...(a.kind === "update_record" ? { field: RECORD_FIELDS[e.target.value as "lead"][0] } : {}) } as Action)}>
        {(a.kind === "update_record" ? (["lead", "work_task"] as const) : ASSIGN_ENTITIES).map((x) => (
          <option key={x} value={x}>
            {t(`workflows.builder.entities.${x}`)}
          </option>
        ))}
      </Select>
    </Field>
  );
  const set = (patch: Record<string, unknown>) => onChange({ ...action, ...patch } as Action);
  const val = (f: string) => (action as Record<string, unknown>)[f];
  const choice = (f: string, options: { value: string; label: string }[], emptyLabel?: string) => (
    <Field label={L(f)} htmlFor={id(f)}>
      <Select id={id(f)} value={String(val(f) ?? "")} onChange={(e) => set({ [f]: e.target.value || undefined })}>
        {emptyLabel !== undefined ? <option value="">{emptyLabel}</option> : null}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Select>
    </Field>
  );
  const number = (f: string, min: number, max: number, optional = true) => (
    <Field label={L(f)} htmlFor={id(f)}>
      <Input
        id={id(f)}
        type="number"
        min={min}
        max={max}
        value={val(f) === undefined ? "" : String(val(f))}
        onChange={(e) => set({ [f]: e.target.value === "" ? (optional ? undefined : min) : Math.max(min, Math.min(max, Number(e.target.value))) })}
      />
    </Field>
  );
  const people = (f: string, hint?: string) => (
    <div className="grid gap-1 sm:col-span-2">
      <p className="text-sm font-medium">{L(f)}</p>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      <UserChecklist value={(val(f) as string[] | undefined) ?? []} users={opts.users} onChange={(v) => set({ [f]: v })} />
    </div>
  );
  const permission = (f: string) => choice(f, opts.permissions.map((p) => ({ value: p, label: p })), "—");
  const toggle = (f: string) => (
    <label className="flex items-center gap-2 text-sm sm:col-span-2">
      <input type="checkbox" className="size-4" checked={!!val(f)} onChange={(e) => set({ [f]: e.target.checked })} />
      {L(f)}
    </label>
  );
  const skipToggle = (
    <label className="flex items-center gap-2 text-sm sm:col-span-2">
      <input type="checkbox" className="size-4" checked={val("ifNotConnected") === "skip"} onChange={(e) => set({ ifNotConnected: e.target.checked ? "skip" : "fail" })} />
      {L("ifNotConnected")}
    </label>
  );
  let body: ReactNode = null;
  switch (action.kind) {
    case "create_lead":
      body = (
        <>
          {text("name", { required: true })}
          {text("email")}
          {text("phone")}
          {text("source")}
          {user("ownerId")}
          {text("notes", { multiline: true })}
        </>
      );
      break;
    case "create_contact":
      body = (
        <>
          {text("firstName", { required: true })}
          {text("lastName")}
          {text("email")}
          {text("phone")}
          {text("title")}
          {text("accountId")}
          {user("ownerId")}
        </>
      );
      break;
    case "create_task":
      body = (
        <>
          {text("title", { required: true })}
          {user("assigneeId")}
          {text("projectId", { placeholder: "{{steps.project.id}}" })}
          <Field label={L("priority")} htmlFor={id("priority")}>
            <Select id={id("priority")} value={action.priority} onChange={(e) => onChange({ ...action, priority: e.target.value as (typeof WORK_PRIORITIES)[number] })}>
              {WORK_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {t(`workflows.builder.priorities.${p}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={L("dueInDays")} htmlFor={id("due")}>
            <Input id={id("due")} type="number" min={0} max={365} value={action.dueInDays ?? ""} onChange={(e) => onChange({ ...action, dueInDays: e.target.value === "" ? undefined : Math.max(0, Math.min(365, Number(e.target.value))) })} />
          </Field>
          {text("description", { multiline: true })}
        </>
      );
      break;
    case "update_lead":
      body = (
        <>
          {text("leadId", { required: true })}
          <Field label={L("stage")} htmlFor={id("stage")}>
            <Select id={id("stage")} value={action.stage ?? ""} onChange={(e) => onChange({ ...action, stage: (e.target.value || undefined) as typeof action.stage })}>
              <option value="">{t("workflows.builder.noChange")}</option>
              {LEAD_STAGE_VALUES.map((s) => (
                <option key={s} value={s}>
                  {t(`crm.stages.${s}`)}
                </option>
              ))}
            </Select>
          </Field>
          {user("ownerId")}
        </>
      );
      break;
    case "update_record":
      body = (
        <>
          {entity(action)}
          {text("recordId", { required: true })}
          <Field label={L("field")} htmlFor={id("field")}>
            <Select id={id("field")} value={action.field} onChange={(e) => onChange({ ...action, field: e.target.value })}>
              {RECORD_FIELDS[action.entity].map((f) => (
                <option key={f} value={f}>
                  {t(`workflows.builder.recordFields.${f}`)}
                </option>
              ))}
            </Select>
          </Field>
          {text("value")}
        </>
      );
      break;
    case "assign_user":
      body = (
        <>
          {entity(action)}
          {text("recordId", { required: true })}
          {user("userId")}
        </>
      );
      break;
    case "create_account":
      body = (
        <>
          {text("name", { required: true })}
          {choice("type", ACCOUNT_TYPE_VALUES.map((v) => ({ value: v, label: t(`workflows.builder.accountTypes.${v}`) })))}
          {text("email")}
          {text("phone")}
          {text("website")}
          {text("source")}
          {user("ownerId")}
        </>
      );
      break;
    case "assign_round_robin":
      body = (
        <>
          {entity(action)}
          {text("recordId", { required: true })}
          {choice("pool", (["users", "permission", "crm_rules"] as const).map((v) => ({ value: v, label: t(`workflows.builder.pools.${v}`) })))}
          {action.pool === "permission" ? permission("permission") : null}
          {action.pool === "crm_rules" ? permission("fallbackPermission") : null}
          {action.pool === "users" ? people("userIds", t("workflows.builder.rotationHint")) : null}
        </>
      );
      break;
    case "load_record":
      body = (
        <>
          {choice("entity", LOAD_ENTITIES.map((v) => ({ value: v, label: t(`workflows.builder.loadEntities.${v}`) })))}
          {text("recordId", { required: true })}
          <p className="text-xs text-muted-foreground sm:col-span-2">{t("workflows.builder.loadHint", { step })}</p>
        </>
      );
      break;
    case "create_deal":
      body = (
        <>
          {text("name", { required: true })}
          {text("accountId")}
          {text("contactId")}
          {user("ownerId")}
          {choice("stageId", opts.stages.map((x) => ({ value: x.id, label: x.name })), t("workflows.builder.defaultStage"))}
          {text("amount", { placeholder: "12000.00" })}
          {number("closeInDays", 0, 730)}
          {text("source")}
          {text("description", { multiline: true })}
        </>
      );
      break;
    case "move_deal_stage":
      body = (
        <>
          {text("dealId", { required: true })}
          {choice("stageId", opts.stages.map((x) => ({ value: x.id, label: x.name })), "—")}
          {text("lostReason")}
        </>
      );
      break;
    case "create_project":
      body = (
        <>
          {text("name", { required: true })}
          {choice("template", opts.projectTemplates.map((x) => ({ value: x.key, label: x.name })), t("workflows.builder.blankProject"))}
          {user("ownerId")}
          {number("startInDays", 0, 365)}
          {number("dueInDays", 0, 730)}
          {text("extraMemberIds", { placeholder: "{{event.data.ownerId}}" })}
          {people("memberIds")}
          {text("description", { multiline: true })}
        </>
      );
      break;
    case "add_project_members":
      body = (
        <>
          {text("projectId", { required: true, placeholder: "{{steps.project.id}}" })}
          {text("role")}
          {text("extraUserIds", { placeholder: "{{event.data.ownerId}}" })}
          {people("userIds")}
        </>
      );
      break;
    case "start_onboarding":
      body = (
        <>
          {text("employeeId", { required: true })}
          {choice("checklist", (["ONBOARDING", "OFFBOARDING"] as const).map((v) => ({ value: v, label: t(`workflows.builder.checklists.${v}`) })))}
          {choice("templateId", opts.hrTemplates.map((x) => ({ value: x.id, label: x.name })), t("workflows.builder.defaultTemplate"))}
        </>
      );
      break;
    case "create_invoice":
      body = (
        <>
          {text("accountId", { required: true })}
          {text("description", { required: true })}
          {text("quantity")}
          {text("unitPrice", { required: true, placeholder: "1500.00" })}
          {number("dueInDays", 0, 365)}
          <p className="text-xs text-muted-foreground sm:col-span-2">{t("workflows.builder.invoiceHint")}</p>
          {text("notes", { multiline: true })}
        </>
      );
      break;
    case "create_meeting":
      body = (
        <>
          {text("title", { required: true })}
          {text("location")}
          {text("startsAt", { placeholder: "{{event.data.startDate}}" })}
          {number("startInHours", 0, 2160, false)}
          {number("durationMinutes", 5, 1440, false)}
          {text("extraAttendeeIds", { placeholder: "{{event.data.ownerId}}" })}
          {people("attendeeIds")}
          {text("agenda", { multiline: true })}
        </>
      );
      break;
    case "assign_ai_employee":
    case "generate_ai_content":
      body = profile(action);
      break;
    case "ai_employee_task":
      body = (
        <>
          {opts.aiEmployees.length ? null : <Notice tone="warning" className="sm:col-span-2">{t("workflows.builder.noAiEmployees")}</Notice>}
          {choice("aiEmployeeId", opts.aiEmployees.map((x) => ({ value: x.id, label: x.name })), "—")}
          {text("title", { required: true })}
          {text("instructions", { multiline: true })}
          {toggle("wait")}
        </>
      );
      break;
    case "decompose_goal":
      body = (
        <>
          {text("objectiveId", { required: true })}
          <p className="text-xs text-muted-foreground sm:col-span-2">{t("workflows.builder.decomposeHint")}</p>
          {text("guidance", { multiline: true })}
          {toggle("wait")}
        </>
      );
      break;
    case "notify":
      body = (
        <>
          <Field label={L("recipients")} htmlFor={id("recipients")}>
            <Select id={id("recipients")} value={action.recipients} onChange={(e) => onChange({ ...action, recipients: e.target.value as "owner" | "users" | "permission" | "field" })}>
              {(["owner", "users", "permission", "field"] as const).map((r) => (
                <option key={r} value={r}>
                  {t(`workflows.builder.recipientOptions.${r}`)}
                </option>
              ))}
            </Select>
          </Field>
          {action.recipients === "permission" ? (
            <Field label={L("permission")} htmlFor={id("permission")}>
              <Select id={id("permission")} value={action.permission ?? ""} onChange={(e) => onChange({ ...action, permission: e.target.value || undefined })}>
                <option value="">—</option>
                {opts.permissions.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
          {action.recipients === "users" ? (
            <div className="grid gap-1 sm:col-span-2">
              <p className="text-sm font-medium">{L("userIds")}</p>
              <UserChecklist value={action.userIds} users={opts.users} onChange={(userIds) => onChange({ ...action, userIds })} />
            </div>
          ) : null}
          {action.recipients === "field" ? text("userField", { placeholder: "{{event.data.ownerId}}" }) : null}
          {text("title", { required: true })}
          <Field label={L("href")} htmlFor={id("href")} hint={t("workflows.builder.hrefHint")}>
            <TemplateInput id={id("href")} value={action.href ?? ""} onChange={(v) => onChange({ ...action, href: v })} vars={vars} placeholder="/crm/{{event.entityId}}" />
          </Field>
        </>
      );
      break;
    case "request_approval":
      body = (
        <>
          {text("title", { required: true })}
          {choice("approverMode", APPROVER_MODES.map((v) => ({ value: v, label: t(`workflows.builder.approverModes.${v}`) })))}
          {action.approverMode === "permission" ? permission("permission") : null}
          {action.approverMode === "record_owner" ? text("ownerField", { placeholder: "{{event.data.ownerId}}" }) : null}
          {action.approverMode === "users" ? people("approverIds", t("workflows.builder.approversHint")) : null}
          {text("message", { multiline: true })}
          {choice("timeoutAction", (["reject", "escalate"] as const).map((v) => ({ value: v, label: t(`workflows.builder.timeoutActions.${v}`) })), t("workflows.builder.noTimeout"))}
          {action.timeoutAction ? number("timeoutHours", 1, 720) : null}
          {action.timeoutAction === "escalate" ? people("escalateToIds") : null}
        </>
      );
      break;
    case "send_email":
      body = (
        <>
          {!opts.connected.email ? <Notice tone="warning" className="sm:col-span-2">{t("workflows.builder.emailNotConfigured")}</Notice> : null}
          {text("to", { required: true })}
          {text("subject", { required: true })}
          {text("body", { multiline: true })}
        </>
      );
      break;
    case "send_slack":
      body = (
        <>
          {!opts.connected.slack ? <ProviderMissing provider="slack" /> : null}
          {text("channel", { required: true, placeholder: "general" })}
          {text("text", { multiline: true })}
          {skipToggle}
        </>
      );
      break;
    case "send_teams":
      body = (
        <>
          {!opts.connected.microsoft ? <ProviderMissing provider="microsoft" /> : null}
          {text("teamId", { required: true })}
          {text("channelId", { required: true })}
          <p className="text-xs text-muted-foreground sm:col-span-2">{t("workflows.builder.teamsHint")}</p>
          {text("text", { multiline: true })}
          {skipToggle}
        </>
      );
      break;
    case "http_webhook":
      body = (
        <>
          <Field label={L("url")} htmlFor={id("url")} className="sm:col-span-2">
            <Input id={id("url")} type="url" value={action.url} maxLength={2000} onChange={(e) => onChange({ ...action, url: e.target.value })} />
          </Field>
          <Field label={L("body")} htmlFor={id("body")} hint={t("workflows.builder.bodyHint")} className="sm:col-span-2">
            <TemplateInput id={id("body")} value={action.body ?? ""} onChange={(v) => onChange({ ...action, body: v })} vars={vars} multiline placeholder='{"name": "{{event.data.name}}"}' />
          </Field>
        </>
      );
      break;
    case "custom_api":
      body = (
        <>
          {!opts.connected.custom_api ? <ProviderMissing provider="custom_api" /> : null}
          <Field label={L("method")} htmlFor={id("method")}>
            <Select id={id("method")} value={action.method} onChange={(e) => onChange({ ...action, method: e.target.value as typeof action.method })}>
              {(["GET", "POST", "PUT", "PATCH", "DELETE"] as const).map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={L("path")} htmlFor={id("path")}>
            <Input id={id("path")} value={action.path} maxLength={500} onChange={(e) => onChange({ ...action, path: e.target.value })} />
          </Field>
          <Field label={L("body")} htmlFor={id("body")} hint={t("workflows.builder.bodyHint")} className="sm:col-span-2">
            <TemplateInput id={id("body")} value={action.body ?? ""} onChange={(v) => onChange({ ...action, body: v })} vars={vars} multiline />
          </Field>
        </>
      );
      break;
  }
  return <div className="grid gap-3 sm:grid-cols-2">{body}</div>;
}

function ProviderMissing({ provider }: { provider: string }) {
  const { t, locale } = useI18n();
  return (
    <Notice tone="warning" className="sm:col-span-2">
      {t("workflows.builder.providerNotConnected")}{" "}
      <Link href={`/${locale}/integrations/${provider}`} className="font-medium underline">
        {t("workflows.builder.connectProvider")}
      </Link>
    </Notice>
  );
}

function StepCard({ step, index, count, onChange, onMove, onRemove, opts, vars, ids, depth, issues }: {
  step: Step;
  index: number;
  count: number;
  onChange: (s: Step) => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
  opts: BuilderOptions;
  vars: string[];
  ids: Set<string>;
  depth: number;
  issues: string[];
}) {
  const t = useT();
  const title = step.type === "action" ? t(`workflows.builder.actions.${step.action.kind}`) : t(`workflows.builder.stepTypes.${step.type}`);
  return (
    <li className={cn("rounded-lg border bg-surface", issues.length ? "border-danger/50" : "")}>
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <span className="grid size-6 place-items-center rounded-full bg-muted text-xs font-medium">{index + 1}</span>
        <span className="font-medium">{title}</span>
        <Input
          aria-label={t("workflows.builder.stepId")}
          className="h-7 w-36 font-mono text-xs"
          value={step.id}
          maxLength={40}
          onChange={(e) => onChange({ ...step, id: e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, "") })}
        />
        <div className="ms-auto flex gap-1">
          <Button type="button" size="icon" variant="ghost" className="size-7" disabled={index === 0} aria-label={t("workflows.builder.moveUp")} onClick={() => onMove(-1)}>
            <ArrowUp aria-hidden />
          </Button>
          <Button type="button" size="icon" variant="ghost" className="size-7" disabled={index === count - 1} aria-label={t("workflows.builder.moveDown")} onClick={() => onMove(1)}>
            <ArrowDown aria-hidden />
          </Button>
          <Button type="button" size="icon" variant="ghost" className="size-7" aria-label={t("workflows.builder.remove")} onClick={onRemove}>
            <Trash2 aria-hidden />
          </Button>
        </div>
      </div>
      <div className="grid gap-3 p-3">
        {issues.map((m) => (
          <p key={m} className="text-xs text-danger" role="alert">
            {m}
          </p>
        ))}
        {step.type === "condition" || step.type === "branch" ? (
          <>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span>{t("workflows.builder.match")}</span>
              <Select className="h-8 w-auto" value={step.match} onChange={(e) => onChange({ ...step, match: e.target.value as "all" | "any" })} aria-label={t("workflows.builder.match")}>
                <option value="all">{t("workflows.builder.matchAll")}</option>
                <option value="any">{t("workflows.builder.matchAny")}</option>
              </Select>
            </div>
            <ConditionsEditor idPrefix={step.id} conditions={step.conditions} vars={vars} onChange={(conditions) => onChange({ ...step, conditions })} />
            {step.type === "condition" ? <p className="text-xs text-muted-foreground">{t("workflows.builder.conditionHelp")}</p> : null}
          </>
        ) : null}
        {step.type === "branch" ? (
          <div className="grid gap-3 lg:grid-cols-2">
            <div className="grid content-start gap-2 rounded-md border border-success/40 p-2">
              <p className="text-xs font-medium text-success">{t("workflows.builder.then")}</p>
              <StepList steps={step.then} onChange={(then) => onChange({ ...step, then })} opts={opts} vars={vars} ids={ids} depth={depth + 1} issues={{}} />
            </div>
            <div className="grid content-start gap-2 rounded-md border p-2">
              <p className="text-xs font-medium text-muted-foreground">{t("workflows.builder.else")}</p>
              <StepList steps={step.else} onChange={(els) => onChange({ ...step, else: els })} opts={opts} vars={vars} ids={ids} depth={depth + 1} issues={{}} />
            </div>
          </div>
        ) : null}
        {step.type === "delay" ? (
          <div className="flex flex-wrap gap-2">
            <Input type="number" className="w-28" min={1} max={365} value={step.amount} aria-label={t("workflows.builder.amount")} onChange={(e) => onChange({ ...step, amount: Math.max(1, Math.min(365, Number(e.target.value) || 1)) })} />
            <Select className="w-36" value={step.unit} aria-label={t("workflows.builder.unit")} onChange={(e) => onChange({ ...step, unit: e.target.value as "minutes" | "hours" | "days" })}>
              {(["minutes", "hours", "days"] as const).map((u) => (
                <option key={u} value={u}>
                  {t(`workflows.builder.units.${u}`)}
                </option>
              ))}
            </Select>
          </div>
        ) : null}
        {step.type === "set_variable" ? (
          <div className="grid gap-3 sm:grid-cols-[12rem_minmax(0,1fr)]">
            <Field label={t("workflows.builder.varName")} htmlFor={`${step.id}-name`}>
              <Input id={`${step.id}-name`} value={step.name} maxLength={40} pattern="[A-Za-z][A-Za-z0-9_]*" onChange={(e) => onChange({ ...step, name: e.target.value })} />
            </Field>
            <Field label={t("workflows.builder.varValue")} htmlFor={`${step.id}-value`}>
              <TemplateInput id={`${step.id}-value`} value={step.value} vars={vars} onChange={(value) => onChange({ ...step, value })} />
            </Field>
          </div>
        ) : null}
        {step.type === "action" ? <ActionEditor step={step.id} action={step.action} onChange={(action) => onChange({ ...step, action })} opts={opts} vars={vars} /> : null}
      </div>
    </li>
  );
}

function AddStep({ onAdd, ids }: { onAdd: (s: Step) => void; ids: Set<string> }) {
  const t = useT();
  const [type, setType] = useState<(typeof STEP_TYPES)[number]>("action");
  const [kind, setKind] = useState<ActionKind>("create_task");
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select className="h-8 w-auto" value={type} aria-label={t("workflows.builder.stepType")} onChange={(e) => setType(e.target.value as (typeof STEP_TYPES)[number])}>
        {STEP_TYPES.map((s) => (
          <option key={s} value={s}>
            {t(`workflows.builder.stepTypes.${s}`)}
          </option>
        ))}
      </Select>
      {type === "action" ? (
        <Select className="h-8 w-auto max-w-full" value={kind} aria-label={t("workflows.builder.actionKind")} onChange={(e) => setKind(e.target.value as ActionKind)}>
          {Object.entries(ACTION_GROUPS).map(([group, kinds]) => (
            <optgroup key={group} label={t(`workflows.builder.actionGroups.${group}`)}>
              {kinds.map((k) => (
                <option key={k} value={k}>
                  {t(`workflows.builder.actions.${k}`)}
                </option>
              ))}
            </optgroup>
          ))}
        </Select>
      ) : null}
      <Button type="button" size="sm" variant="secondary" onClick={() => onAdd(newStep(type, ids, kind))}>
        <Plus aria-hidden />
        {t("workflows.builder.addStep")}
      </Button>
    </div>
  );
}

function StepList({ steps, onChange, opts, vars, ids, depth, issues }: { steps: Step[]; onChange: (s: Step[]) => void; opts: BuilderOptions; vars: string[]; ids: Set<string>; depth: number; issues: Record<string, string[]> }) {
  const t = useT();
  const move = (i: number, dir: -1 | 1) => {
    const next = [...steps];
    const [s] = next.splice(i, 1);
    next.splice(i + dir, 0, s!);
    onChange(next);
  };
  return (
    <div className="grid gap-2">
      {steps.length ? (
        <ol className="grid gap-2">
          {steps.map((s, i) => (
            <StepCard
              key={`${i}-${s.type}`}
              step={s}
              index={i}
              count={steps.length}
              depth={depth}
              opts={opts}
              vars={vars}
              ids={ids}
              issues={issues[s.id] ?? []}
              onChange={(n) => onChange(steps.map((x, j) => (j === i ? n : x)))}
              onMove={(dir) => move(i, dir)}
              onRemove={() => onChange(steps.filter((_, j) => j !== i))}
            />
          ))}
        </ol>
      ) : (
        <p className="text-xs text-muted-foreground">{depth ? t("workflows.builder.emptyBranch") : t("workflows.builder.noSteps")}</p>
      )}
      {depth < 3 ? <AddStep ids={ids} onAdd={(s) => onChange([...steps, s])} /> : null}
    </div>
  );
}

/** Form-based visual workflow builder: trigger, variables and a nested step list, saved as the draft and published as versions. */
export function WorkflowBuilder({ base, workflowId, initial, opts, canManage, publishedVersion }: { base: string; workflowId: string; initial: Definition; opts: BuilderOptions; canManage: boolean; publishedVersion: number }) {
  const t = useT();
  const [def, setDef] = useState<Definition>(initial);
  const [dirty, setDirty] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const { busy, error, run } = useAction();
  const update = (d: Definition) => {
    setDef(d);
    setDirty(true);
    setNotice(null);
  };
  const vars = useMemo(() => variableSuggestions(def), [def]);
  const ids = useMemo(() => new Set(flattenSteps(def.steps).map((s) => s.id)), [def]);
  const validation = useMemo(() => validateDefinition(def), [def]);
  const issuesByStep = useMemo(() => {
    const out: Record<string, string[]> = {};
    if (validation.ok) return out;
    for (const i of validation.issues) {
      const m = /^steps\.([a-z0-9_-]+)/.exec(i.path);
      if (m && ids.has(m[1]!)) (out[m[1]!] ??= []).push(i.message);
    }
    return out;
  }, [validation, ids]);
  const serverIssues = error instanceof ApiError ? ((error.details?.issues as { path: string; message: string }[] | undefined) ?? []) : [];

  const save = () => run(() => api(`${base}/workflows/${workflowId}`, { method: "PATCH", body: { draft: def } }), () => {
    setDirty(false);
    setNotice(t("workflows.builder.saved"));
  });
  const publish = () =>
    run(async () => {
      await api(`${base}/workflows/${workflowId}`, { method: "PATCH", body: { draft: def } });
      return api<{ version: number }>(`${base}/workflows/${workflowId}/publish`, { method: "POST", body: {} });
    }, (r) => {
      setDirty(false);
      setNotice(t("workflows.builder.published", { version: r.version }));
    });

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader title={t("workflows.builder.trigger")} description={t("workflows.builder.triggerHelp")} />
        <div className="p-4">
          <TriggerEditor trigger={def.trigger} opts={opts} vars={vars} onChange={(trigger) => update({ ...def, trigger })} />
        </div>
      </Card>
      <Card>
        <CardHeader title={t("workflows.builder.variables")} description={t("workflows.builder.variablesHelp")} />
        <div className="grid gap-2 p-4">
          {def.variables.map((v, i) => (
            <div key={i} className="grid gap-2 sm:grid-cols-[12rem_minmax(0,1fr)_auto]">
              <Input value={v.name} aria-label={t("workflows.builder.varName")} maxLength={40} onChange={(e) => update({ ...def, variables: def.variables.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
              <TemplateInput id={`var-${i}`} value={v.value} vars={vars.filter((x) => x.startsWith("event."))} onChange={(value) => update({ ...def, variables: def.variables.map((x, j) => (j === i ? { ...x, value } : x)) })} />
              <Button type="button" size="icon" variant="ghost" aria-label={t("workflows.builder.remove")} onClick={() => update({ ...def, variables: def.variables.filter((_, j) => j !== i) })}>
                <Trash2 aria-hidden />
              </Button>
            </div>
          ))}
          <Button type="button" size="sm" variant="ghost" className="justify-self-start" onClick={() => update({ ...def, variables: [...def.variables, { name: `var${def.variables.length + 1}`, value: "" }] })}>
            <Plus aria-hidden />
            {t("workflows.builder.addVariable")}
          </Button>
        </div>
      </Card>
      <Card>
        <CardHeader title={t("workflows.builder.steps")} description={t("workflows.builder.stepsHelp")} />
        <div className="p-4">
          <StepList steps={def.steps} onChange={(steps) => update({ ...def, steps })} opts={opts} vars={vars} ids={ids} depth={0} issues={issuesByStep} />
        </div>
      </Card>
      <div className="sticky bottom-0 z-10 grid gap-2 rounded-lg border bg-surface p-3 shadow-sm">
        {!validation.ok ? (
          <details>
            <summary className="cursor-pointer text-sm text-warning">{t("workflows.builder.issues", { count: validation.issues.length })}</summary>
            <ul className="mt-1 grid gap-0.5 text-xs text-muted-foreground">
              {validation.issues.map((i, n) => (
                <li key={n}>
                  <span className="font-mono">{i.path || "definition"}</span>: {i.message}
                </li>
              ))}
            </ul>
          </details>
        ) : (
          <p className="text-sm text-success">{t("workflows.builder.valid")}</p>
        )}
        {canManage ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="secondary" disabled={busy} onClick={() => void save()}>
              <Save aria-hidden />
              {t("workflows.builder.saveDraft")}
            </Button>
            <Button type="button" disabled={busy || !validation.ok} onClick={() => void publish()}>
              <Rocket aria-hidden />
              {publishedVersion ? t("workflows.builder.publishNew", { version: publishedVersion + 1 }) : t("workflows.builder.publish")}
            </Button>
            {dirty ? <Badge tone="warning">{t("workflows.builder.unsaved")}</Badge> : null}
            {notice ? <span className="text-sm text-success">{notice}</span> : null}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">{t("workflows.readOnly")}</p>
        )}
        <FormError error={error} />
        {serverIssues.length ? (
          <ul className="grid gap-0.5 text-xs text-danger">
            {serverIssues.map((i, n) => (
              <li key={n}>
                <span className="font-mono">{i.path}</span>: {i.message}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
