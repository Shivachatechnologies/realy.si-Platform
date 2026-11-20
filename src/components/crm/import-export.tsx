"use client";

import { useState } from "react";
import { Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Select, Textarea } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { FormError } from "@/components/form-error";
import { useT } from "@/i18n/client";
import { api } from "@/lib/api-client";
import { useAction } from "./kit";

const ENTITIES = ["leads", "contacts", "accounts", "deals"] as const;
type Entity = (typeof ENTITIES)[number];

interface PreviewRow {
  line: number;
  status: "new" | "duplicate" | "invalid";
  label: string;
  error?: string;
}
interface Preview {
  columns: string[];
  truncated: boolean;
  rows?: PreviewRow[];
  counts: { new: number; duplicate: number; invalid: number };
  created?: number;
}

const TONE = { new: "success", duplicate: "warning", invalid: "danger" } as const;

/** Paste or upload CSV → preview (duplicates flagged) → import the new rows. */
export function CsvImport({ base }: { base: string }) {
  const t = useT();
  const [entity, setEntity] = useState<Entity>("leads");
  const [csv, setCsv] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [done, setDone] = useState<Preview | null>(null);
  const { busy, error, run } = useAction();
  const call = (mode: "preview" | "commit") =>
    run(
      () => api<Preview>(`${base}/crm/import`, { body: { entity, csv, mode } }),
      (r) => (mode === "preview" ? (setPreview(r), setDone(null)) : (setDone(r), setPreview(null), setCsv(""))),
    );
  return (
    <div className="grid gap-3 p-4">
      <div className="grid gap-3 sm:grid-cols-[12rem_minmax(0,1fr)] sm:items-end">
        <Field label={t("crm.import.entity")} htmlFor="imp-entity">
          <Select id="imp-entity" value={entity} onChange={(e) => (setEntity(e.target.value as Entity), setPreview(null))}>
            {ENTITIES.map((x) => (
              <option key={x} value={x}>
                {t(`crm.import.entities.${x}`)}
              </option>
            ))}
          </Select>
        </Field>
        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-md border bg-surface px-3 text-sm hover:bg-muted">
            <Upload className="size-4" aria-hidden />
            {t("crm.import.upload")}
            <input
              type="file"
              accept=".csv,text/csv,text/plain"
              className="sr-only"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file) return;
                setCsv(await file.text());
                setPreview(null);
              }}
            />
          </label>
          <span className="text-xs text-muted-foreground">{t(`crm.import.columns.${entity}`)}</span>
        </div>
      </div>
      <Field label={t("crm.import.paste")} htmlFor="imp-csv" hint={t("crm.import.hint")}>
        <Textarea id="imp-csv" rows={8} className="font-mono text-xs" value={csv} onChange={(e) => (setCsv(e.target.value), setPreview(null))} />
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="secondary" disabled={busy || !csv.trim()} onClick={() => void call("preview")}>
          {t("crm.import.preview")}
        </Button>
        {preview ? (
          <Button type="button" disabled={busy || !preview.counts.new} onClick={() => void call("commit")}>
            {t("crm.import.importRows", { count: preview.counts.new })}
          </Button>
        ) : null}
      </div>
      <FormError error={error} />
      {done ? <Notice tone="success">{t("crm.import.done", { created: done.created ?? 0, duplicate: done.counts.duplicate, invalid: done.counts.invalid })}</Notice> : null}
      {preview ? (
        <div className="grid gap-2">
          <p className="text-sm">
            {t("crm.import.summary", { new: preview.counts.new, duplicate: preview.counts.duplicate, invalid: preview.counts.invalid })}
            {preview.columns.length ? <span className="ms-2 text-xs text-muted-foreground">{t("crm.import.detected", { columns: preview.columns.join(", ") })}</span> : null}
          </p>
          {!preview.columns.length ? <Notice tone="warning">{t("crm.import.noColumns")}</Notice> : null}
          {preview.truncated ? <Notice tone="warning">{t("crm.import.truncated")}</Notice> : null}
          <div className="max-h-96 overflow-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-surface-2 text-xs text-muted-foreground">
                <tr>
                  <th className="p-2 text-start font-medium">{t("crm.import.line")}</th>
                  <th className="p-2 text-start font-medium">{t("crm.name")}</th>
                  <th className="p-2 text-start font-medium">{t("crm.import.result")}</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {(preview.rows ?? []).map((r) => (
                  <tr key={r.line}>
                    <td className="p-2 tabular-nums text-muted-foreground">{r.line}</td>
                    <td className="p-2">{r.label || "—"}</td>
                    <td className="p-2">
                      <Badge tone={TONE[r.status]}>{t(`crm.import.status.${r.status}`)}</Badge>
                      {r.error ? <span className="ms-2 text-xs text-muted-foreground">{t("crm.import.invalidField", { field: r.error })}</span> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  );
}
