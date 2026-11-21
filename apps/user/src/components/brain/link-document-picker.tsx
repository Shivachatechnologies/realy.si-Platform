"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select } from "@/components/ui/input";
import { FormError } from "@/components/form-error";
import { useT } from "@/i18n/client";
import { api } from "@/lib/api-client";

/** Link an existing Company Brain document to a record (used by <RelatedKnowledge />). */
export function LinkDocumentPicker({ organizationId, companyId, subjectType, subjectId }: { organizationId: string; companyId: string; subjectType: string; subjectId: string }) {
  const t = useT();
  const router = useRouter();
  const base = `/api/v1/organizations/${organizationId}/companies/${companyId}/brain`;
  const [q, setQ] = useState("");
  const [docs, setDocs] = useState<{ id: string; title: string }[]>([]);
  const [documentId, setDocumentId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    let stale = false;
    const id = setTimeout(async () => {
      try {
        const r = await api<{ data: { id: string; title: string }[] }>(`${base}/documents?limit=20&sort=title&q=${encodeURIComponent(q)}`);
        if (stale) return;
        setDocs(r.data);
        setDocumentId((cur) => (r.data.some((d) => d.id === cur) ? cur : (r.data[0]?.id ?? "")));
      } catch (e) {
        if (!stale) setError(e);
      }
    }, 250);
    return () => {
      stale = true;
      clearTimeout(id);
    };
  }, [base, q]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!documentId) return;
    setBusy(true);
    setError(null);
    try {
      await api(`${base}/documents/${documentId}/links`, { body: { subjectType, subjectId } });
      router.refresh();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
      <Field label={t("brain.related.findDocument")} htmlFor={`rk-q-${subjectId}`}>
        <Input id={`rk-q-${subjectId}`} type="search" value={q} maxLength={200} onChange={(e) => setQ(e.target.value)} />
      </Field>
      <Field label={t("brain.related.document")} htmlFor={`rk-doc-${subjectId}`}>
        <Select id={`rk-doc-${subjectId}`} value={documentId} disabled={!docs.length} onChange={(e) => setDocumentId(e.target.value)}>
          {docs.length === 0 ? <option value="">{t("brain.links.noMatches")}</option> : null}
          {docs.map((d) => (
            <option key={d.id} value={d.id}>
              {d.title}
            </option>
          ))}
        </Select>
      </Field>
      <Button type="submit" disabled={busy || !documentId}>
        <Link2 aria-hidden />
        {t("brain.links.add")}
      </Button>
      <div className="sm:col-span-3">
        <FormError error={error} />
      </div>
    </form>
  );
}
