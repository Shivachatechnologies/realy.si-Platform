"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select } from "@/components/ui/input";
import { FormError } from "@/components/form-error";
import { useT } from "@/i18n/client";
import { api } from "@/lib/api-client";
import { useAction, type Owner } from "./lead-forms";

const PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;

/** Create a sales task (WorkTask linked to a deal / lead / account). */
export function NewSalesTaskForm({ base, subjectType, subjectId, owners, defaultAssignee }: { base: string; subjectType: "deal" | "lead" | "account"; subjectId: string; owners: Owner[]; defaultAssignee?: string | null }) {
  const t = useT();
  const empty = { title: "", dueDate: "", assigneeId: defaultAssignee ?? "", priority: "MEDIUM" };
  const [f, setF] = useState(empty);
  const { busy, error, run } = useAction();
  const id = `st-${subjectType}`;
  return (
    <form
      className="grid gap-2 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        void run(() => api(`${base}/crm/sales-tasks`, { body: { subjectType, subjectId, ...f } }), () => setF(empty));
      }}
    >
      <Field label={t("crm.salesTasks.title")} htmlFor={`${id}-title`} className="sm:col-span-2">
        <Input id={`${id}-title`} value={f.title} required maxLength={300} placeholder={t("crm.salesTasks.titlePlaceholder")} onChange={(e) => setF((p) => ({ ...p, title: e.target.value }))} />
      </Field>
      <Field label={t("crm.salesTasks.assignee")} htmlFor={`${id}-assignee`}>
        <Select id={`${id}-assignee`} value={f.assigneeId} onChange={(e) => setF((p) => ({ ...p, assigneeId: e.target.value }))}>
          <option value="">{t("crm.unassigned")}</option>
          {owners.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("crm.dueDate")} htmlFor={`${id}-due`}>
        <Input id={`${id}-due`} type="date" value={f.dueDate} onChange={(e) => setF((p) => ({ ...p, dueDate: e.target.value }))} />
      </Field>
      <Field label={t("crm.priority")} htmlFor={`${id}-priority`}>
        <Select id={`${id}-priority`} value={f.priority} onChange={(e) => setF((p) => ({ ...p, priority: e.target.value }))}>
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {t(`crm.salesTasks.priorities.${p}`)}
            </option>
          ))}
        </Select>
      </Field>
      <div className="flex items-end">
        <Button type="submit" variant="secondary" disabled={busy || !f.title.trim()}>
          <Plus aria-hidden />
          {t("crm.salesTasks.add")}
        </Button>
      </div>
      <div className="sm:col-span-2">
        <FormError error={error} />
      </div>
    </form>
  );
}

/** Inline controls of one sales task: complete / reopen, assignee, due date, delete. */
export function SalesTaskControls({ base, task, owners }: { base: string; task: { id: string; done: boolean; assigneeId: string | null; dueDate: string | null; title: string }; owners: Owner[] }) {
  const t = useT();
  const { busy, error, run } = useAction();
  const patch = (body: Record<string, unknown>) => run(() => api(`${base}/crm/sales-tasks/${task.id}`, { method: "PATCH", body }));
  return (
    <div className="grid gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1.5 text-sm">
          <input type="checkbox" className="size-4 accent-primary" checked={task.done} disabled={busy} onChange={(e) => void patch({ done: e.target.checked })} aria-label={t("crm.salesTasks.complete")} />
          <span className={task.done ? "text-muted-foreground line-through" : "font-medium"}>{task.title}</span>
        </label>
      </div>
      {task.done ? null : (
        <div className="flex flex-wrap items-center gap-1">
          <Select aria-label={t("crm.salesTasks.assignee")} className="h-8 w-auto text-xs" value={task.assigneeId ?? ""} disabled={busy} onChange={(e) => void patch({ assigneeId: e.target.value || null })}>
            <option value="">{t("crm.unassigned")}</option>
            {owners.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </Select>
          <Input aria-label={t("crm.dueDate")} type="date" className="h-8 w-auto text-xs" defaultValue={task.dueDate ?? ""} disabled={busy} onBlur={(e) => (e.target.value !== (task.dueDate ?? "") ? void patch({ dueDate: e.target.value || null }) : undefined)} />
          <Button
            type="button"
            size="icon"
            variant="ghost"
            disabled={busy}
            aria-label={t("crm.delete")}
            title={t("crm.delete")}
            onClick={() => {
              if (window.confirm(t("crm.deleteConfirm"))) void run(() => api(`${base}/crm/sales-tasks/${task.id}`, { method: "DELETE" }));
            }}
          >
            <Trash2 aria-hidden />
          </Button>
        </div>
      )}
      <FormError error={error} />
    </div>
  );
}
