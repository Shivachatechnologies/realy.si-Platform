"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormError } from "@/components/form-error";
import { useT } from "@/i18n/client";
import { api } from "@/lib/api-client";

/** Upload a CSV of employees and show what was created, updated or rejected. */
export function CsvImport({ endpoint, columns }: { endpoint: string; columns: string[] }) {
  const t = useT();
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [result, setResult] = useState<{ created: number; updated: number; errors: { row: number; message: string }[] } | null>(null);
  return (
    <div className="grid gap-2 p-3">
      <p className="text-xs text-muted-foreground">{t("hr.employees.importHint", { columns: columns.join(", ") })}</p>
      <div className="flex flex-wrap items-center gap-2">
        <Input type="file" accept=".csv,text/csv" className="max-w-xs" aria-label={t("hr.employees.importFile")} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        <Button
          type="button"
          variant="secondary"
          disabled={!file || busy}
          onClick={async () => {
            if (!file) return;
            setBusy(true);
            setError(null);
            setResult(null);
            try {
              setResult(await api(endpoint, { body: { csv: await file.text() } }));
              router.refresh();
            } catch (err) {
              setError(err);
            } finally {
              setBusy(false);
            }
          }}
        >
          <Upload aria-hidden />
          {busy ? t("hr.employees.importing") : t("hr.employees.import")}
        </Button>
      </div>
      <FormError error={error} />
      {result ? (
        <div className="text-sm">
          <p>{t("hr.employees.importResult", { created: result.created, updated: result.updated, errors: result.errors.length })}</p>
          {result.errors.length ? (
            <ul className="mt-1 list-disc ps-5 text-xs text-danger">
              {result.errors.map((e) => (
                <li key={e.row}>{t("hr.employees.importRowError", { row: e.row, message: e.message })}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
