"use client";

import { useState } from "react";
import { Check, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { FormError } from "@/components/form-error";
import { useT } from "@/i18n/client";
import { api } from "@/lib/api-client";
import { useAction } from "./ui";

/** Start an AI task on a marketing record (POST <path> { kind, note, aiEmployeeId }). With `employees`, the person can assign a specific AI employee instead of the default role. */
export function AiRequest({
  path,
  kind,
  label,
  notePlaceholder,
  noteRequired,
  employees,
}: {
  path: string;
  kind: string;
  label: string;
  notePlaceholder?: string;
  noteRequired?: boolean;
  employees?: { id: string; name: string; jobTitle: string | null }[];
}) {
  const t = useT();
  const [note, setNote] = useState("");
  const [employee, setEmployee] = useState("");
  const { busy, error, run } = useAction();
  return (
    <form
      className="grid gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        void run(() => api(path, { body: { kind, note: note.trim() || undefined, aiEmployeeId: employee || undefined } }), () => setNote(""));
      }}
    >
      <div className="flex flex-wrap gap-2">
        {notePlaceholder !== undefined ? (
          <Input className="min-w-0 flex-1" value={note} maxLength={2000} required={noteRequired} placeholder={notePlaceholder} aria-label={notePlaceholder} onChange={(e) => setNote(e.target.value)} />
        ) : null}
        {employees?.length ? (
          <Select className="min-w-0 sm:w-48" value={employee} aria-label={t("marketing.ai.assignTo")} onChange={(e) => setEmployee(e.target.value)}>
            <option value="">{t("marketing.ai.defaultRole")}</option>
            {employees.map((x) => (
              <option key={x.id} value={x.id}>
                {x.jobTitle ? `${x.name} · ${x.jobTitle}` : x.name}
              </option>
            ))}
          </Select>
        ) : null}
        <Button type="submit" size="sm" disabled={busy || (noteRequired && !note.trim())}>
          <Sparkles aria-hidden />
          {busy ? t("marketing.ai.starting") : label}
        </Button>
      </div>
      <FormError error={error} />
    </form>
  );
}

/** Copy a completed task's output into the record (POST <path> { taskId, target }). */
export function ApplyAi({ path, taskId, target, label, contentType }: { path: string; taskId: string; target: "body" | "meta" | "keywords" | "content"; label: string; contentType?: string }) {
  const t = useT();
  const { busy, error, run } = useAction();
  const [done, setDone] = useState(false);
  return (
    <span className="inline-grid gap-1">
      <Button type="button" size="sm" variant="secondary" disabled={busy || done} onClick={() => void run(() => api(path, { body: { taskId, target, contentType } }), () => setDone(true))}>
        <Check aria-hidden />
        {done ? t("marketing.ai.applied") : label}
      </Button>
      <FormError error={error} />
    </span>
  );
}
