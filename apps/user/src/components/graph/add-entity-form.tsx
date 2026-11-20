"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import type { GraphEntityKind } from "@/generated/prisma/enums";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { FormError } from "@/components/form-error";
import { useT } from "@/i18n/client";
import { api } from "@/lib/api-client";

/** Add one Company Graph entity of a fixed kind (used by the People, Products and Customers pages). */
export function AddEntityForm({ organizationId, companyId, kind }: { organizationId: string; companyId: string; kind: GraphEntityKind }) {
  const t = useT();
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(`/api/v1/organizations/${organizationId}/companies/${companyId}/graph/entities`, { body: { kind, name, description: description || undefined } });
      setName("");
      setDescription("");
      router.refresh();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="grid gap-2 border-b p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto] sm:items-end">
      <Field label={t("graph.name")} htmlFor={`add-${kind}-name`}>
        <Input id={`add-${kind}-name`} value={name} maxLength={160} required onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label={t("graph.description")} htmlFor={`add-${kind}-description`}>
        <Input id={`add-${kind}-description`} value={description} maxLength={2000} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      <Button type="submit" disabled={busy || !name.trim()}>
        <Plus aria-hidden />
        {t("graph.addEntity")}
      </Button>
      <div className="sm:col-span-3">
        <FormError error={error} />
      </div>
    </form>
  );
}
