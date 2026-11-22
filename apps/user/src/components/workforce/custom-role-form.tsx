"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Archive, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select, Textarea } from "@/components/ui/input";
import { FormError } from "@/components/form-error";
import { useT } from "@/i18n/client";
import { api, ApiError } from "@/lib/api-client";

export interface AssignableTool {
  name: string;
  label: string;
  needsApproval: boolean;
}

/**
 * Define a company-specific AI role (B24): name, department, role prompt, the tools it may use (only registered,
 * agent-safe tools; supervised ones still need approval) and its turn limit. Saved as data; hire it like any role.
 */
export function CustomRoleForm({ apiBase, departments, tools }: { apiBase: string; departments: { key: string; label: string }[]; tools: AssignableTool[] }) {
  const t = useT();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [v, setV] = useState({ name: "", department: departments[0]?.key ?? "operations", description: "", instructions: "", maxTurns: 8 });
  const [picked, setPicked] = useState<string[]>(["search_company_brain", "read_objectives"].filter((n) => tools.some((x) => x.name === n)));
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const fields = error instanceof ApiError ? error.fieldErrors() : {};
  const shown = useMemo(() => tools.filter((x) => !q || x.label.toLowerCase().includes(q.toLowerCase()) || x.name.includes(q.toLowerCase())), [tools, q]);
  if (!open) {
    return (
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus aria-hidden />
        {t("workforce.roles.create")}
      </Button>
    );
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(`${apiBase}/workforce/roles`, { body: { ...v, description: v.description || null, tools: picked } });
      setOpen(false);
      setV({ name: "", department: departments[0]?.key ?? "operations", description: "", instructions: "", maxTurns: 8 });
      router.refresh();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="grid gap-3 rounded-lg border bg-surface p-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={t("workforce.roles.name")} htmlFor="role-name" error={fields.name} className="sm:col-span-2">
          <Input id="role-name" required minLength={2} maxLength={80} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />
        </Field>
        <Field label={t("workforce.roles.department")} htmlFor="role-dept">
          <Select id="role-dept" value={v.department} onChange={(e) => setV({ ...v, department: e.target.value })}>
            {departments.map((d) => (
              <option key={d.key} value={d.key}>
                {d.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label={t("workforce.roles.description")} htmlFor="role-desc">
        <Input id="role-desc" maxLength={500} value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} />
      </Field>
      <Field label={t("workforce.roles.instructions")} htmlFor="role-instr" hint={t("workforce.roles.instructionsHint")} error={fields.instructions}>
        <Textarea id="role-instr" rows={5} required minLength={20} maxLength={6000} value={v.instructions} onChange={(e) => setV({ ...v, instructions: e.target.value })} />
      </Field>
      <fieldset className="grid gap-2">
        <legend className="text-sm font-medium">{t("workforce.roles.tools", { count: picked.length })}</legend>
        <Input aria-label={t("common.searchPlaceholder")} placeholder={t("common.searchPlaceholder")} value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="grid max-h-56 gap-1 overflow-y-auto rounded-md border p-2 sm:grid-cols-2">
          {shown.map((tool) => (
            <label key={tool.name} className="flex items-center gap-2 text-xs">
              <input type="checkbox" className="size-4 accent-primary" checked={picked.includes(tool.name)} onChange={(e) => setPicked((p) => (e.target.checked ? [...p, tool.name] : p.filter((n) => n !== tool.name)))} />
              <span>
                {tool.label}
                {tool.needsApproval ? <span className="text-warning"> · {t("workforce.needsApproval")}</span> : null}
              </span>
            </label>
          ))}
        </div>
        {fields.tools ? <p className="text-xs text-danger">{fields.tools}</p> : null}
      </fieldset>
      <Field label={t("workforce.roles.maxTurns")} htmlFor="role-turns" hint={t("workforce.roles.maxTurnsHint")}>
        <Input id="role-turns" type="number" min={1} max={15} value={v.maxTurns} onChange={(e) => setV({ ...v, maxTurns: Number(e.target.value) || 8 })} />
      </Field>
      <FormError error={error} />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy || !picked.length}>
          {busy ? t("common.saving") : t("workforce.roles.save")}
        </Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
          {t("common.cancel")}
        </Button>
      </div>
    </form>
  );
}

/** Archive a custom role (refused while AI employees still hold it). */
export function ArchiveRoleButton({ apiBase, roleId, name }: { apiBase: string; roleId: string; name: string }) {
  const t = useT();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  return (
    <span className="inline-grid gap-1">
      <Button
        size="sm"
        variant="ghost"
        disabled={busy}
        onClick={async () => {
          if (!window.confirm(t("workforce.roles.archiveConfirm", { name }))) return;
          setBusy(true);
          setError(null);
          try {
            await api(`${apiBase}/workforce/roles/${roleId}`, { method: "DELETE" });
            router.refresh();
          } catch (err) {
            setError(err);
          } finally {
            setBusy(false);
          }
        }}
      >
        <Archive aria-hidden />
        {t("workforce.roles.archive")}
      </Button>
      <FormError error={error} />
    </span>
  );
}
