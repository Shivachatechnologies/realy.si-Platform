"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select, Textarea } from "@/components/ui/input";
import { FormError } from "@/components/form-error";
import { useI18n, useT } from "@/i18n/client";
import { api, ApiError } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { AUTONOMY_OPTIONS } from "./employee-form";

const PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;
type Tab = "assign" | "priorities" | "approvals" | "team";

export interface CeoActionsData {
  employees: { id: string; name: string; status: "ACTIVE" | "PAUSED"; autonomy: (typeof AUTONOMY_OPTIONS)[number]; monthlyTokenBudget: number | null }[];
  members: { id: string; name: string }[];
  workTasks: { id: string; title: string; priority: (typeof PRIORITIES)[number]; assigneeId: string | null; dueDate: string | null; overdue: boolean }[];
  aiTasks: { id: string; title: string; status: string; aiEmployeeId: string | null }[];
  approvals: { id: string; summary: string; risk: string }[];
  can: { run: boolean; manageAgents: boolean; projects: boolean; decide: boolean };
}

/** Run one API call and refresh; returns the error for display. */
function useCall() {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  async function call(key: string, path: string, method: string, body?: unknown) {
    setBusy(key);
    setError(null);
    try {
      await api(path, { method, body: body ?? {} });
      router.refresh();
      return true;
    } catch (err) {
      setError(err);
      return false;
    } finally {
      setBusy(null);
    }
  }
  return { busy, error, call };
}

function AssignWork({ apiBase, data }: { apiBase: string; data: CeoActionsData }) {
  const t = useT();
  const { locale } = useI18n();
  const router = useRouter();
  const [target, setTarget] = useState<"ai" | "person">(data.can.run ? "ai" : "person");
  const [who, setWho] = useState("");
  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");
  const [due, setDue] = useState("");
  const [priority, setPriority] = useState<(typeof PRIORITIES)[number]>("MEDIUM");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const fields = error instanceof ApiError ? error.fieldErrors() : {};
  const active = data.employees.filter((e) => e.status === "ACTIVE");

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (target === "ai") {
        const task = await api<{ id: string }>(`${apiBase}/tasks`, { body: { aiEmployeeId: who, title, instructions: details || title } });
        router.push(`/${locale}/tasks/${task.id}`);
      } else {
        const task = await api<{ id: string }>(`${apiBase}/work/tasks`, { body: { title, description: details || undefined, assigneeId: who || undefined, dueDate: due || undefined, priority } });
        router.push(`/${locale}/projects/tasks/${task.id}`);
      }
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-3">
      <div className="flex flex-wrap gap-3 text-sm" role="radiogroup" aria-label={t("intelligence.actions.assignTo")}>
        {data.can.run ? (
          <label className="flex items-center gap-1.5">
            <input type="radio" name="target" checked={target === "ai"} onChange={() => (setTarget("ai"), setWho(""))} />
            {t("intelligence.actions.toAi")}
          </label>
        ) : null}
        {data.can.projects ? (
          <label className="flex items-center gap-1.5">
            <input type="radio" name="target" checked={target === "person"} onChange={() => (setTarget("person"), setWho(""))} />
            {t("intelligence.actions.toPerson")}
          </label>
        ) : null}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={target === "ai" ? t("intelligence.actions.aiEmployee") : t("intelligence.actions.person")} htmlFor="ceo-assign-who" error={fields.aiEmployeeId ?? fields.assigneeId}>
          <Select id="ceo-assign-who" value={who} required={target === "ai"} onChange={(e) => setWho(e.target.value)}>
            <option value="">{target === "ai" ? "—" : t("intelligence.actions.unassigned")}</option>
            {(target === "ai" ? active : data.members).map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("agentTasks.taskTitle")} htmlFor="ceo-assign-title" error={fields.title}>
          <Input id="ceo-assign-title" value={title} maxLength={200} required onChange={(e) => setTitle(e.target.value)} />
        </Field>
      </div>
      <Field label={target === "ai" ? t("agentTasks.instructions") : t("intelligence.actions.description")} htmlFor="ceo-assign-details" error={fields.instructions ?? fields.description}>
        <Textarea id="ceo-assign-details" rows={3} maxLength={8000} value={details} onChange={(e) => setDetails(e.target.value)} />
      </Field>
      {target === "person" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("intelligence.actions.dueDate")} htmlFor="ceo-assign-due" error={fields.dueDate}>
            <Input id="ceo-assign-due" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
          </Field>
          <Field label={t("intelligence.actions.priority")} htmlFor="ceo-assign-priority">
            <Select id="ceo-assign-priority" value={priority} onChange={(e) => setPriority(e.target.value as typeof priority)}>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {t(`intelligence.actions.priorities.${p}`)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      ) : null}
      <FormError error={error} />
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="sm" disabled={busy || (target === "ai" && !who)}>
          {busy ? t("common.saving") : t("intelligence.actions.assign")}
        </Button>
        <Link className="text-xs text-primary hover:underline" href={`/${locale}/objectives/goals`}>
          {t("intelligence.actions.setGoal")}
        </Link>
      </div>
    </form>
  );
}

function Priorities({ apiBase, data }: { apiBase: string; data: CeoActionsData }) {
  const t = useT();
  const { busy, error, call } = useCall();
  const [reassign, setReassign] = useState<Record<string, string>>({});
  return (
    <div className="grid gap-4">
      <section className="grid gap-2">
        <h3 className="text-xs font-semibold text-muted-foreground">{t("intelligence.actions.workTasks")}</h3>
        {!data.can.projects ? (
          <p className="text-sm text-muted-foreground">{t("errors.forbidden")}</p>
        ) : data.workTasks.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("intelligence.actions.noWorkTasks")}</p>
        ) : (
          <ul className="grid gap-2">
            {data.workTasks.map((w) => (
              <li key={w.id} className="grid gap-2 rounded-md border p-2 text-sm sm:grid-cols-[minmax(0,1fr)_9rem_12rem] sm:items-center">
                <span className="min-w-0 truncate">
                  {w.title}
                  {w.overdue ? <Badge tone="danger" className="ms-2">{t("intelligence.actions.overdue")}</Badge> : null}
                </span>
                <label className="sr-only" htmlFor={`prio-${w.id}`}>
                  {t("intelligence.actions.priority")}
                </label>
                <Select id={`prio-${w.id}`} className="h-8" value={w.priority} disabled={busy === w.id} onChange={(e) => void call(w.id, `${apiBase}/work/tasks/${w.id}`, "PATCH", { priority: e.target.value })}>
                  {PRIORITIES.map((p) => (
                    <option key={p} value={p}>
                      {t(`intelligence.actions.priorities.${p}`)}
                    </option>
                  ))}
                </Select>
                <label className="sr-only" htmlFor={`assignee-${w.id}`}>
                  {t("intelligence.actions.person")}
                </label>
                <Select id={`assignee-${w.id}`} className="h-8" value={w.assigneeId ?? ""} disabled={busy === `a${w.id}`} onChange={(e) => void call(`a${w.id}`, `${apiBase}/work/tasks/${w.id}`, "PATCH", { assigneeId: e.target.value || null })}>
                  <option value="">{t("intelligence.actions.unassigned")}</option>
                  {data.members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </Select>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="grid gap-2">
        <h3 className="text-xs font-semibold text-muted-foreground">{t("intelligence.actions.aiTasks")}</h3>
        {!data.can.run ? (
          <p className="text-sm text-muted-foreground">{t("errors.forbidden")}</p>
        ) : data.aiTasks.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("intelligence.actions.noAiTasks")}</p>
        ) : (
          <ul className="grid gap-2">
            {data.aiTasks.map((x) => (
              <li key={x.id} className="grid gap-2 rounded-md border p-2 text-sm sm:grid-cols-[minmax(0,1fr)_12rem_auto] sm:items-center">
                <span className="min-w-0 truncate">
                  {x.title} <Badge>{t(`agentTasks.status.${x.status}`)}</Badge>
                </span>
                <label className="sr-only" htmlFor={`re-${x.id}`}>
                  {t("intelligence.actions.aiEmployee")}
                </label>
                <Select id={`re-${x.id}`} className="h-8" value={reassign[x.id] ?? ""} onChange={(e) => setReassign((s) => ({ ...s, [x.id]: e.target.value }))}>
                  <option value="">—</option>
                  {data.employees
                    .filter((e) => e.status === "ACTIVE" && e.id !== x.aiEmployeeId)
                    .map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.name}
                      </option>
                    ))}
                </Select>
                <Button type="button" size="sm" variant="secondary" disabled={!reassign[x.id] || busy === `r${x.id}`} onClick={() => void call(`r${x.id}`, `${apiBase}/workforce/tasks/${x.id}/reassign`, "POST", { aiEmployeeId: reassign[x.id] })}>
                  {t("intelligence.actions.reassign")}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <FormError error={error} />
    </div>
  );
}

function Approvals({ apiBase, data }: { apiBase: string; data: CeoActionsData }) {
  const t = useT();
  const { locale } = useI18n();
  const { busy, error, call } = useCall();
  if (data.approvals.length === 0) return <p className="text-sm text-muted-foreground">{t("intelligence.card.noDecisions")}</p>;
  return (
    <div className="grid gap-2">
      <ul className="grid gap-2">
        {data.approvals.map((a) => (
          <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2 text-sm">
            <span className="min-w-0 flex-1">
              {a.summary} <Badge tone={a.risk === "HIGH" || a.risk === "CRITICAL" ? "danger" : "warning"}>{a.risk}</Badge>
            </span>
            {data.can.decide ? (
              <span className="flex gap-1">
                <Button type="button" size="sm" disabled={busy === a.id} onClick={() => void call(a.id, `${apiBase}/approvals/${a.id}/decision`, "POST", { decision: "approve" })}>
                  <Check aria-hidden />
                  {t("intelligence.actions.approve")}
                </Button>
                <Button type="button" size="sm" variant="ghost" disabled={busy === a.id} onClick={() => void call(a.id, `${apiBase}/approvals/${a.id}/decision`, "POST", { decision: "reject" })}>
                  <X aria-hidden />
                  {t("intelligence.actions.reject")}
                </Button>
              </span>
            ) : null}
          </li>
        ))}
      </ul>
      <Link className="text-xs text-primary hover:underline" href={`/${locale}/approvals`}>
        {t("intelligence.actions.allApprovals")}
      </Link>
      <FormError error={error} />
    </div>
  );
}

function Team({ apiBase, data }: { apiBase: string; data: CeoActionsData }) {
  const t = useT();
  const { busy, error, call } = useCall();
  const [budgets, setBudgets] = useState<Record<string, string>>({});
  if (!data.employees.length) return <p className="text-sm text-muted-foreground">{t("workforce.empty")}</p>;
  return (
    <div className="grid gap-2">
      <ul className="grid gap-2">
        {data.employees.map((e) => (
          <li key={e.id} className="grid gap-2 rounded-md border p-2 text-sm md:grid-cols-[minmax(0,1fr)_auto_12rem_14rem] md:items-center">
            <span className="min-w-0 truncate font-medium">{e.name}</span>
            <Button type="button" size="sm" variant="secondary" disabled={!data.can.manageAgents || busy === `s${e.id}`} onClick={() => void call(`s${e.id}`, `${apiBase}/workforce/employees/${e.id}/status`, "POST", { status: e.status === "ACTIVE" ? "PAUSED" : "ACTIVE" })}>
              {e.status === "ACTIVE" ? t("workforce.employee.pause") : t("intelligence.actions.activate")}
            </Button>
            <label className="sr-only" htmlFor={`aut-${e.id}`}>
              {t("workforce.form.autonomy")}
            </label>
            <Select id={`aut-${e.id}`} className="h-8" value={e.autonomy} disabled={!data.can.manageAgents || busy === `a${e.id}`} onChange={(ev) => void call(`a${e.id}`, `${apiBase}/workforce/employees/${e.id}`, "PATCH", { autonomy: ev.target.value })}>
              {AUTONOMY_OPTIONS.map((a) => (
                <option key={a} value={a}>
                  {t(`workforce.autonomy.${a}.name`)}
                </option>
              ))}
            </Select>
            <form
              className="flex gap-1"
              onSubmit={(ev) => {
                ev.preventDefault();
                const raw = budgets[e.id] ?? (e.monthlyTokenBudget?.toString() ?? "");
                void call(`b${e.id}`, `${apiBase}/workforce/employees/${e.id}`, "PATCH", { monthlyTokenBudget: raw ? Number(raw) : null });
              }}
            >
              <label className="sr-only" htmlFor={`bud-${e.id}`}>
                {t("workforce.form.budget")}
              </label>
              <Input
                id={`bud-${e.id}`}
                className="h-8"
                type="number"
                min={1000}
                step={1000}
                placeholder={t("workforce.employee.noBudget")}
                disabled={!data.can.manageAgents}
                value={budgets[e.id] ?? (e.monthlyTokenBudget?.toString() ?? "")}
                onChange={(ev) => setBudgets((s) => ({ ...s, [e.id]: ev.target.value }))}
              />
              <Button type="submit" size="sm" variant="ghost" disabled={!data.can.manageAgents || busy === `b${e.id}`}>
                {t("common.save")}
              </Button>
            </form>
          </li>
        ))}
      </ul>
      <FormError error={error} />
    </div>
  );
}

/** CEO actions: assign work, set goals, priorities and reassignment, approvals, and the AI team's status, autonomy and budgets. */
export function CeoActions({ apiBase, data }: { apiBase: string; data: CeoActionsData }) {
  const t = useT();
  const [tab, setTab] = useState<Tab>("assign");
  const tabs: { key: Tab; label: string; badge?: ReactNode }[] = [
    { key: "assign", label: t("intelligence.actions.tabs.assign") },
    { key: "priorities", label: t("intelligence.actions.tabs.priorities") },
    { key: "approvals", label: t("intelligence.actions.tabs.approvals"), badge: data.approvals.length ? <Badge tone="warning">{data.approvals.length}</Badge> : null },
    { key: "team", label: t("intelligence.actions.tabs.team") },
  ];
  return (
    <div className="grid gap-3">
      <div role="tablist" aria-label={t("intelligence.actions.title")} className="flex gap-1 overflow-x-auto border-b text-sm">
        {tabs.map((x) => (
          <button
            key={x.key}
            type="button"
            role="tab"
            aria-selected={tab === x.key}
            onClick={() => setTab(x.key)}
            className={cn("-mb-px flex shrink-0 items-center gap-1 border-b-2 px-3 py-2", tab === x.key ? "border-primary font-medium" : "border-transparent text-muted-foreground hover:text-foreground")}
          >
            {x.label}
            {x.badge}
          </button>
        ))}
      </div>
      <div role="tabpanel">
        {tab === "assign" ? (
          data.can.run || data.can.projects ? <AssignWork apiBase={apiBase} data={data} /> : <p className="text-sm text-muted-foreground">{t("errors.forbidden")}</p>
        ) : tab === "priorities" ? (
          <Priorities apiBase={apiBase} data={data} />
        ) : tab === "approvals" ? (
          <Approvals apiBase={apiBase} data={data} />
        ) : (
          <Team apiBase={apiBase} data={data} />
        )}
      </div>
    </div>
  );
}
