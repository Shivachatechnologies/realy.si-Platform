"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Save, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import { FormError } from "@/components/form-error";
import { useI18n, useT } from "@/i18n/client";
import { api } from "@/lib/api-client";

/** Rename / describe a Company Graph entity, or delete it (with its relations). */
export function EntityEditForm({ organizationId, companyId, entity }: { organizationId: string; companyId: string; entity: { id: string; name: string; description: string | null } }) {
  const t = useT();
  const { locale } = useI18n();
  const router = useRouter();
  const url = `/api/v1/organizations/${organizationId}/companies/${companyId}/graph/entities/${entity.id}`;
  const [name, setName] = useState(entity.name);
  const [description, setDescription] = useState(entity.description ?? "");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await api(url, { method: "PATCH", body: { name, description: description.trim() || null } });
      setSaved(true);
      router.refresh();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm(t("graph.confirmDelete"))) return;
    setBusy(true);
    setError(null);
    try {
      await api(url, { method: "DELETE" });
      router.push(`/${locale}/graph`);
      router.refresh();
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-3">
      <Field label={t("graph.name")} htmlFor="entity-name">
        <Input id="entity-name" value={name} required maxLength={160} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label={t("graph.description")} htmlFor="entity-description">
        <Textarea id="entity-description" rows={3} value={description} maxLength={2000} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      <FormError error={error} />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" disabled={busy || !name.trim()}>
          <Save aria-hidden />
          {t("graph.save")}
        </Button>
        {saved ? <span className="text-xs text-success">{t("graph.saved")}</span> : null}
        <Button type="button" size="sm" variant="ghost" className="ms-auto" disabled={busy} onClick={remove}>
          <Trash2 aria-hidden />
          {t("graph.deleteEntity")}
        </Button>
      </div>
    </form>
  );
}
