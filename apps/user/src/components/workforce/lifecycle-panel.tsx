"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { FormError } from "@/components/form-error";
import { useI18n } from "@/i18n/client";
import { formatNumber } from "@/i18n/format";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";

type Action = "record" | "assign" | "promote" | "change_role" | "change_manager" | "change_permissions" | "evaluate" | "replace" | "retire";
const LEVELS = ["SPECIALIST", "MANAGER", "EXECUTIVE"] as const;
const AUTONOMY = ["READ_ONLY", "RECOMMEND", "PREPARE", "EXECUTE_WITH_APPROVAL", "AUTONOMOUS_LOW_RISK"] as const;
const DAYS = [1, 2, 3, 4, 5, 6, 0];

export interface LifecycleProps {
  apiBase: string;
  employee: {
    id: string;
    name: string;
    level: (typeof LEVELS)[number];
    department: string;
    profileKey: string;
    managerEmployeeId: string | null;
    managerUserId: string | null;
    autonomy: (typeof AUTONOMY)[number];
    allowedTools: string[];
    runsAsUserId: string | null;
    personality: string | null;
    communicationStyle: string | null;
    timezone: string | null;
    workingHours: { days: number[]; start: string; end: string } | null;
  };
  roles: { key: string; label: string }[];
  departments: { key: string; label: string }[];
  employees: { id: string; name: string }[];
  members: { id: string; name: string }[];
  /** The role's tools; `yours` = the requester holds the tool's permissions (only those can be granted). */
  tools: { name: string; label: string; yours: boolean }[];
}

/** Lifecycle actions of an AI employee (each audited server-side): record, assign, promote, role, manager, permissions, evaluate, replace, retire. */
export function LifecyclePanel(p: LifecycleProps) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const e = p.employee;
  const [action, setAction] = useState<Action>("record");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState<ReactNode>(null);
  // Field state (one per action; reset on switch is not needed: each submits its own subset).
  const [personality, setPersonality] = useState(e.personality ?? "");
  const [style, setStyle] = useState(e.communicationStyle ?? "");
  const [tz, setTz] = useState(e.timezone ?? "");
  const [hoursOn, setHoursOn] = useState(!!e.workingHours);
  const [days, setDays] = useState<number[]>(e.workingHours?.days ?? [1, 2, 3, 4, 5]);
  const [start, setStart] = useState(e.workingHours?.start ?? "09:00");
  const [end, setEnd] = useState(e.workingHours?.end ?? "17:00");
  const [department, setDepartment] = useState(e.department);
  const [level, setLevel] = useState<(typeof LEVELS)[number]>(e.level === "SPECIALIST" ? "MANAGER" : "EXECUTIVE");
  const [role, setRole] = useState(e.profileKey);
  const [manager, setManager] = useState(e.managerEmployeeId ? `ai:${e.managerEmployeeId}` : e.managerUserId ? `user:${e.managerUserId}` : "");
  const [autonomy, setAutonomy] = useState(e.autonomy);
  const [tools, setTools] = useState<string[]>(e.allowedTools.length ? e.allowedTools : p.tools.filter((x) => x.yours).map((x) => x.name));
  const [successor, setSuccessor] = useState("");
  const [reason, setReason] = useState("");

  const base = `${p.apiBase}/workforce/employees/${e.id}`;
  const managerBody = () => (manager.startsWith("ai:") ? { managerEmployeeId: manager.slice(3) } : manager.startsWith("user:") ? { managerUserId: manager.slice(5) } : {});

  async function submit(ev: FormEvent) {
    ev.preventDefault();
    if (action === "retire" && !window.confirm(t("workforce.lifecycle.confirmRetire", { name: e.name }))) return;
    if (action === "replace" && !window.confirm(t("workforce.lifecycle.confirmReplace", { name: e.name }))) return;
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      if (action === "record") {
        await api(base, { method: "PATCH", body: { personality: personality || null, communicationStyle: style || null, timezone: tz || null, workingHours: hoursOn ? { days, start, end } : null } });
        setDone(t("workforce.lifecycle.saved"));
      } else {
        const body: Record<string, unknown> =
          action === "assign"
            ? { action, department, ...managerBody() }
            : action === "promote"
              ? { action, level }
              : action === "change_role"
                ? { action, profileKey: role }
                : action === "change_manager"
                  ? { action, ...managerBody() }
                  : action === "change_permissions"
                    ? { action, autonomy, allowedTools: tools.length === p.tools.length ? [] : tools }
                    : action === "replace"
                      ? { action, ...(successor ? { replacementEmployeeId: successor } : {}) }
                      : action === "retire"
                        ? { action, ...(reason ? { reason } : {}) }
                        : { action };
        const r = await api<{ score?: number | null; verdict?: string; successorId?: string; movedTasks?: number }>(`${base}/lifecycle`, { body });
        if (action === "evaluate" && r?.verdict) setDone(t("workforce.lifecycle.evaluated", { verdict: t(`workforce.lifecycle.verdicts.${r.verdict}`), score: r.score === null || r.score === undefined ? "—" : formatNumber(r.score, locale) }));
        else if (action === "replace" && r?.successorId) {
          router.push(`/${locale}/workforce/${r.successorId}`);
          return;
        } else if (action === "retire") {
          router.push(`/${locale}/workforce`);
          return;
        } else setDone(t("workforce.lifecycle.saved"));
      }
      router.refresh();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  const actions: Action[] = ["record", "assign", "promote", "change_role", "change_manager", "change_permissions", "evaluate", "replace", "retire"];
  const managerSelect = (
    <Field label={t("workforce.lifecycle.manager")} htmlFor="lc-manager">
      <Select id="lc-manager" value={manager} onChange={(ev) => setManager(ev.target.value)} required={action === "change_manager"}>
        <option value="">{t("workforce.lifecycle.keepManager")}</option>
        <optgroup label={t("workforce.lifecycle.aiManagers")}>
          {p.employees.map((x) => (
            <option key={x.id} value={`ai:${x.id}`}>
              {x.name}
            </option>
          ))}
        </optgroup>
        <optgroup label={t("workforce.lifecycle.people")}>
          {p.members.map((x) => (
            <option key={x.id} value={`user:${x.id}`}>
              {x.name}
            </option>
          ))}
        </optgroup>
      </Select>
    </Field>
  );

  return (
    <form className="grid gap-4" onSubmit={submit}>
      <div className="flex flex-wrap gap-1" role="tablist" aria-label={t("workforce.lifecycle.title")}>
        {actions.map((a) => (
          <button
            key={a}
            type="button"
            role="tab"
            aria-selected={action === a}
            onClick={() => {
              setAction(a);
              setDone(null);
              setError(null);
            }}
            className={cn("min-h-9 rounded-md border px-2.5 text-xs", action === a ? "border-primary bg-accent text-accent-foreground" : "bg-surface hover:bg-muted", a === "retire" && "text-danger")}
          >
            {t(`workforce.lifecycle.actions.${a}`)}
          </button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">{t(`workforce.lifecycle.hints.${action}`)}</p>

      {action === "record" ? (
        <div className="grid gap-3 md:grid-cols-2">
          <Field label={t("workforce.record.personality")} htmlFor="lc-personality" hint={t("workforce.record.personalityHint")}>
            <Textarea id="lc-personality" rows={2} maxLength={500} value={personality} onChange={(ev) => setPersonality(ev.target.value)} />
          </Field>
          <Field label={t("workforce.record.communicationStyle")} htmlFor="lc-style" hint={t("workforce.record.communicationStyleHint")}>
            <Textarea id="lc-style" rows={2} maxLength={500} value={style} onChange={(ev) => setStyle(ev.target.value)} />
          </Field>
          <Field label={t("workforce.record.timezone")} htmlFor="lc-tz" hint={t("workforce.record.timezoneHint")}>
            <Input id="lc-tz" value={tz} maxLength={64} placeholder="Europe/Ljubljana" onChange={(ev) => setTz(ev.target.value)} />
          </Field>
          <fieldset className="grid gap-2">
            <legend className="text-[13px] font-medium">{t("workforce.record.workingHours")}</legend>
            <label className="flex min-h-9 items-center gap-2 text-sm">
              <input type="checkbox" checked={hoursOn} onChange={(ev) => setHoursOn(ev.target.checked)} />
              {t("workforce.record.limitHours")}
            </label>
            {hoursOn ? (
              <>
                <div className="flex flex-wrap gap-1">
                  {DAYS.map((d) => (
                    <label key={d} className={cn("inline-flex min-h-9 cursor-pointer items-center rounded-md border px-2 text-xs", days.includes(d) && "border-primary bg-accent")}>
                      <input type="checkbox" className="sr-only" checked={days.includes(d)} onChange={() => setDays((list) => (list.includes(d) ? list.filter((x) => x !== d) : [...list, d]))} />
                      {t(`workforce.record.days.${d}`)}
                    </label>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <Input aria-label={t("workforce.record.start")} type="time" value={start} onChange={(ev) => setStart(ev.target.value)} className="w-32" />
                  <span aria-hidden>–</span>
                  <Input aria-label={t("workforce.record.end")} type="time" value={end} onChange={(ev) => setEnd(ev.target.value)} className="w-32" />
                </div>
              </>
            ) : null}
          </fieldset>
        </div>
      ) : null}
      {action === "assign" ? (
        <div className="grid gap-3 md:grid-cols-2">
          <Field label={t("workforce.record.department")} htmlFor="lc-dept">
            <Select id="lc-dept" value={department} onChange={(ev) => setDepartment(ev.target.value)}>
              {p.departments.map((d) => (
                <option key={d.key} value={d.key}>
                  {d.label}
                </option>
              ))}
            </Select>
          </Field>
          {managerSelect}
        </div>
      ) : null}
      {action === "promote" ? (
        e.level === "EXECUTIVE" ? (
          <Notice tone="info">{t("workforce.lifecycle.topLevel")}</Notice>
        ) : (
          <Field label={t("workforce.record.level")} htmlFor="lc-level">
            <Select id="lc-level" value={level} onChange={(ev) => setLevel(ev.target.value as (typeof LEVELS)[number])}>
              {LEVELS.filter((l) => LEVELS.indexOf(l) > LEVELS.indexOf(e.level)).map((l) => (
                <option key={l} value={l}>
                  {t(`workforce.levels.${l}.name`)}
                </option>
              ))}
            </Select>
          </Field>
        )
      ) : null}
      {action === "change_role" ? (
        <Field label={t("workforce.lifecycle.role")} htmlFor="lc-role" hint={t("workforce.lifecycle.roleHint")}>
          <Select id="lc-role" value={role} onChange={(ev) => setRole(ev.target.value)}>
            {p.roles.map((r) => (
              <option key={r.key} value={r.key}>
                {r.label}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}
      {action === "change_manager" ? managerSelect : null}
      {action === "change_permissions" ? (
        <div className="grid gap-3">
          <Field label={t("workforce.form.autonomy")} htmlFor="lc-autonomy">
            <Select id="lc-autonomy" value={autonomy} onChange={(ev) => setAutonomy(ev.target.value as (typeof AUTONOMY)[number])}>
              {AUTONOMY.map((a) => (
                <option key={a} value={a}>
                  {t(`workforce.autonomy.${a}.name`)}
                </option>
              ))}
            </Select>
          </Field>
          <fieldset className="grid gap-1">
            <legend className="text-[13px] font-medium">{t("workforce.lifecycle.tools")}</legend>
            <div className="grid gap-1 sm:grid-cols-2">
              {p.tools.map((x) => (
                <label key={x.name} className={cn("flex min-h-8 items-center gap-2 text-sm", !x.yours && "text-muted-foreground")}>
                  <input type="checkbox" disabled={!x.yours} checked={tools.includes(x.name)} onChange={() => setTools((list) => (list.includes(x.name) ? list.filter((n) => n !== x.name) : [...list, x.name]))} />
                  {x.label}
                  {!x.yours ? <span className="text-[11px]">({t("workforce.lifecycle.notYours")})</span> : null}
                </label>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">{t("workforce.lifecycle.narrowHint")}</p>
          </fieldset>
        </div>
      ) : null}
      {action === "replace" ? (
        <Field label={t("workforce.lifecycle.successor")} htmlFor="lc-successor">
          <Select id="lc-successor" value={successor} onChange={(ev) => setSuccessor(ev.target.value)}>
            <option value="">{t("workforce.lifecycle.hireSuccessor")}</option>
            {p.employees.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}
      {action === "retire" ? (
        <Field label={t("workforce.lifecycle.reason")} htmlFor="lc-reason">
          <Input id="lc-reason" maxLength={500} value={reason} onChange={(ev) => setReason(ev.target.value)} />
        </Field>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" disabled={busy || (action === "promote" && e.level === "EXECUTIVE")} variant={action === "retire" ? "danger" : "default"}>
          {busy ? t("common.saving") : t(`workforce.lifecycle.submit.${action}`)}
        </Button>
        {done ? (
          <span role="status" className="text-sm text-success">
            {done}
          </span>
        ) : null}
      </div>
      <FormError error={error} />
    </form>
  );
}
