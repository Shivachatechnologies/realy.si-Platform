"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormError } from "@/components/form-error";
import { useT } from "@/i18n/client";
import { api } from "@/lib/api-client";

/** Inline rename (PATCH { title }). */
export function RenameForm({ path, title }: { path: string; title: string }) {
  const t = useT();
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(title);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(path, { method: "PATCH", body: { title: value } });
      setEditing(false);
      router.refresh();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  if (!editing)
    return (
      <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(true)}>
        <Pencil aria-hidden />
        {t("intelligence.chat.rename")}
      </Button>
    );
  return (
    <form onSubmit={submit} className="flex flex-wrap items-center gap-2">
      <label className="sr-only" htmlFor="rename-title">
        {t("intelligence.chat.rename")}
      </label>
      <Input id="rename-title" className="h-8 w-64" value={value} maxLength={120} required onChange={(e) => setValue(e.target.value)} />
      <Button type="submit" size="sm" disabled={busy}>
        {t("common.save")}
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
        {t("common.cancel")}
      </Button>
      <FormError error={error} />
    </form>
  );
}
