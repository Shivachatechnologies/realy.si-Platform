"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select } from "@/components/ui/input";
import { FormError } from "@/components/form-error";
import { useT } from "@/i18n/client";
import { api } from "@/lib/api-client";

export function NewProjectForm({ organizationId, workspaces }: { organizationId: string; workspaces: { id: string; name: string }[] }) {
  const t = useT();
  const router = useRouter();
  const [workspaceId, setWorkspaceId] = useState(workspaces[0]?.id ?? "");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(`/api/v1/organizations/${organizationId}/workspaces/${workspaceId}/projects`, { body: { name } });
      setName("");
      router.refresh();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="grid gap-2 border-b p-3 sm:grid-cols-[14rem_minmax(0,1fr)_auto] sm:items-end">
      <Field label={t("projects.workspace")} htmlFor="project-workspace">
        <Select id="project-workspace" value={workspaceId} onChange={(e) => setWorkspaceId(e.target.value)}>
          {workspaces.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("projects.name")} htmlFor="project-name">
        <Input id="project-name" value={name} maxLength={120} required onChange={(e) => setName(e.target.value)} />
      </Field>
      <Button type="submit" disabled={busy || !name.trim() || !workspaceId}>
        <Plus aria-hidden />
        {t("projects.create")}
      </Button>
      <div className="sm:col-span-3">
        <FormError error={error} />
      </div>
    </form>
  );
}
