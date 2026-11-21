"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Save } from "lucide-react";
import { parseTags } from "@/components/brain/add-document-form";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select } from "@/components/ui/input";
import { FormError } from "@/components/form-error";
import { useT } from "@/i18n/client";
import { api } from "@/lib/api-client";

/** Edit a document's title (uploaded documents only), department and tags. */
export function DocumentMetaForm({
  organizationId,
  companyId,
  document,
  departments,
}: {
  organizationId: string;
  companyId: string;
  document: { id: string; title: string; departmentId: string | null; tags: string[]; sourceType: string | null };
  departments: { id: string; name: string }[];
}) {
  const t = useT();
  const router = useRouter();
  const [title, setTitle] = useState(document.title);
  const [departmentId, setDepartmentId] = useState(document.departmentId ?? "");
  const [tags, setTags] = useState(document.tags.join(", "));
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await api(`/api/v1/organizations/${organizationId}/companies/${companyId}/brain/documents/${document.id}`, {
        method: "PATCH",
        body: { ...(document.sourceType ? {} : { title }), departmentId: departmentId || null, tags: parseTags(tags) },
      });
      setSaved(true);
      router.refresh();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-3">
      <div className="grid gap-3 sm:grid-cols-3">
        {document.sourceType ? null : (
          <Field label={t("brain.titleLabel")} htmlFor="doc-title">
            <Input id="doc-title" value={title} required maxLength={200} onChange={(e) => setTitle(e.target.value)} />
          </Field>
        )}
        <Field label={t("brain.department")} htmlFor="doc-department">
          <Select id="doc-department" value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
            <option value="">{t("brain.noDepartment")}</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("brain.tags")} htmlFor="doc-tags" hint={t("brain.tagsHint")}>
          <Input id="doc-tags" value={tags} maxLength={400} onChange={(e) => setTags(e.target.value)} />
        </Field>
      </div>
      <FormError error={error} />
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" disabled={busy}>
          <Save aria-hidden />
          {t("brain.save")}
        </Button>
        {saved ? <span className="text-xs text-success">{t("brain.saved")}</span> : null}
      </div>
    </form>
  );
}
