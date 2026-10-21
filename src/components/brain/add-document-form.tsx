"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import { FormError } from "@/components/form-error";
import { useI18n, useT } from "@/i18n/client";
import { api, ApiError } from "@/lib/api-client";
import { ACCEPTED_EXTENSIONS, MAX_DOCUMENT_BYTES, MAX_PDF_BYTES } from "@/server/modules/brain/extract";

/** Base64 of a file's bytes, in chunks (spreading a large array into String.fromCharCode overflows the stack). */
async function toBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** Add a document by file (.txt / .md as text, .pdf as bytes) or pasted text. The server validates and extracts it. */
export function AddDocumentForm({ organizationId, companyId }: { organizationId: string; companyId: string }) {
  const t = useT();
  const { locale } = useI18n();
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [hasFile, setHasFile] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const file = fileRef.current?.files?.[0];
    const isPdf = Boolean(file?.name.toLowerCase().endsWith(".pdf"));
    if (file && file.size > (isPdf ? MAX_PDF_BYTES : MAX_DOCUMENT_BYTES)) {
      setError(new ApiError("validation_error", t("brain.tooLarge")));
      return;
    }
    setBusy(true);
    try {
      const doc = await api<{ id: string }>(`/api/v1/organizations/${organizationId}/companies/${companyId}/brain/documents`, {
        body: {
          title: title.trim() || undefined,
          ...(file ? { filename: file.name, ...(isPdf ? { contentBase64: await toBase64(file) } : { content: await file.text() }) } : { content: text }),
        },
      });
      router.push(`/${locale}/brain/${doc.id}`);
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader title={t("brain.add")} description={t("brain.addHint", { types: ACCEPTED_EXTENSIONS.join(", ") })} />
      <CardBody>
        <form onSubmit={submit} className="grid gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("brain.file")} htmlFor="brain-file">
              <Input id="brain-file" ref={fileRef} type="file" accept={ACCEPTED_EXTENSIONS.join(",")} onChange={(e) => setHasFile(Boolean(e.target.files?.length))} />
            </Field>
            <Field label={t("brain.titleLabel")} htmlFor="brain-title" hint={t("brain.titleHint")}>
              <Input id="brain-title" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />
            </Field>
          </div>
          {hasFile ? null : (
            <Field label={t("brain.paste")} htmlFor="brain-text">
              <Textarea id="brain-text" rows={6} value={text} onChange={(e) => setText(e.target.value)} />
            </Field>
          )}
          <FormError error={error} />
          <div>
            <Button type="submit" disabled={busy}>
              <Upload aria-hidden />
              {busy ? t("brain.indexing") : t("brain.addSubmit")}
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}
