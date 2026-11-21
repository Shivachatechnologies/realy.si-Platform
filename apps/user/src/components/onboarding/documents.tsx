"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CircleCheck, CircleX, FileText, LoaderCircle, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/form-error";
import { useI18n } from "@/i18n/client";
import { api, ApiError } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { ACCEPTED_EXTENSIONS, MAX_DOCUMENT_BYTES, MAX_PDF_BYTES } from "@/server/modules/brain/extract";

/** Base64 of a file's bytes, in chunks (spreading a large array into String.fromCharCode overflows the stack). */
async function toBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

const isPdf = (f: File) => f.name.toLowerCase().endsWith(".pdf");
const accepted = (f: File) => ACCEPTED_EXTENSIONS.some((e) => f.name.toLowerCase().endsWith(e));
const tooLarge = (f: File) => f.size > (isPdf(f) ? MAX_PDF_BYTES : MAX_DOCUMENT_BYTES);

/** Upload one founder document into Company Brain for the run (the research steps read it). */
export async function uploadRunDocument(base: string, file: File) {
  return api<{ sourceId: string; documentId: string }>(`${base}/sources`, {
    body: { title: file.name.replace(/\.[^.]+$/, "").slice(0, 200), filename: file.name, ...(isPdf(file) ? { contentBase64: await toBase64(file) } : { content: await file.text() }) },
  });
}

export type FileState = { file: File; status: "ready" | "uploading" | "done" | "failed"; error?: string };

/** Drop zone + list: picks .txt / .md / .pdf files, refuses unsupported or oversized ones right away (no upload). */
export function DocumentPicker({ files, onChange, disabled }: { files: FileState[]; onChange: (f: FileState[]) => void; disabled?: boolean }) {
  const { t } = useI18n();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [refused, setRefused] = useState<string[]>([]);
  const add = (list: FileList | null) => {
    if (!list) return;
    const ok: FileState[] = [];
    const bad: string[] = [];
    for (const f of Array.from(list)) {
      if (!accepted(f) || tooLarge(f)) bad.push(f.name);
      else if (!files.some((x) => x.file.name === f.name && x.file.size === f.size)) ok.push({ file: f, status: "ready" });
    }
    setRefused(bad);
    onChange([...files, ...ok].slice(0, 10));
  };
  return (
    <div className="grid gap-2">
      <button
        type="button"
        disabled={disabled}
        onClick={() => input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          add(e.dataTransfer.files);
        }}
        className={cn(
          "grid min-h-28 place-items-center gap-1 rounded-2xl border border-dashed bg-surface/60 px-4 py-5 text-center text-sm transition-colors hover:border-primary hover:bg-accent/40 disabled:opacity-60",
          over && "border-primary bg-accent/50",
        )}
      >
        <Upload className="size-5 text-primary" aria-hidden />
        <span className="font-medium">{t("onboarding.journey.vision.docs.drop")}</span>
        <span className="text-xs text-muted-foreground">{t("onboarding.journey.vision.docs.types", { types: ACCEPTED_EXTENSIONS.join(", "), pdf: MAX_PDF_BYTES / 1_000_000, text: MAX_DOCUMENT_BYTES / 1_000_000 })}</span>
      </button>
      <input ref={input} type="file" multiple hidden accept={ACCEPTED_EXTENSIONS.join(",")} onChange={(e) => (add(e.target.files), (e.target.value = ""))} />
      {refused.length ? <p className="text-xs text-danger" role="alert">{t("onboarding.journey.vision.docs.refused", { files: refused.join(", ") })}</p> : null}
      {files.length ? (
        <ul className="grid gap-1.5">
          {files.map((f, i) => (
            <li key={`${f.file.name}-${i}`} className="flex items-center gap-2 rounded-lg border bg-surface px-3 py-2 text-sm">
              {f.status === "uploading" ? <LoaderCircle className="size-4 animate-spin text-primary" aria-hidden /> : f.status === "done" ? <CircleCheck className="size-4 text-success" aria-hidden /> : f.status === "failed" ? <CircleX className="size-4 text-danger" aria-hidden /> : <FileText className="size-4 text-muted-foreground" aria-hidden />}
              <span className="min-w-0 flex-1 truncate">{f.file.name}</span>
              <span className="text-xs text-muted-foreground">{t(`onboarding.journey.vision.docs.status.${f.status}`)}</span>
              {f.status === "ready" && !disabled ? (
                <button type="button" className="grid size-8 place-items-center rounded-md hover:bg-muted" aria-label={t("onboarding.journey.vision.docs.remove", { name: f.file.name })} onClick={() => onChange(files.filter((_, k) => k !== i))}>
                  <X className="size-4" aria-hidden />
                </button>
              ) : null}
              {f.error ? <span className="sr-only">{f.error}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
      {files.some((f) => f.error) ? (
        <ul className="grid gap-1 text-xs text-danger">
          {files.filter((f) => f.error).map((f) => (
            <li key={f.file.name}>
              {f.file.name}: {f.error}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** Upload files one after another, reporting each file's real outcome. */
export async function uploadAll(base: string, files: FileState[], update: (f: FileState[]) => void) {
  const next = [...files];
  for (let i = 0; i < next.length; i++) {
    if (next[i]!.status === "done") continue;
    next[i] = { ...next[i]!, status: "uploading" };
    update([...next]);
    try {
      await uploadRunDocument(base, next[i]!.file);
      next[i] = { ...next[i]!, status: "done", error: undefined };
    } catch (err) {
      next[i] = { ...next[i]!, status: "failed", error: err instanceof ApiError ? err.message : String(err) };
    }
    update([...next]);
  }
  return next;
}

/** After the run exists: add more documents to Company Brain for it. */
export function AddRunDocuments({ base }: { base: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const [files, setFiles] = useState<FileState[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  return (
    <div className="grid gap-2">
      <DocumentPicker files={files} onChange={setFiles} disabled={busy} />
      <FormError error={error} />
      {files.some((f) => f.status === "ready" || f.status === "failed") ? (
        <div>
          <Button
            size="sm"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await uploadAll(base, files, setFiles);
                router.refresh();
              } catch (err) {
                setError(err);
              } finally {
                setBusy(false);
              }
            }}
          >
            {t("onboarding.journey.vision.docs.upload")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
