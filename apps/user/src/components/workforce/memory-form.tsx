"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { FormError } from "@/components/form-error";
import { useT } from "@/i18n/client";
import { api } from "@/lib/api-client";

export function MemoryForm({ path }: { path: string }) {
  const t = useT();
  const router = useRouter();
  const [content, setContent] = useState("");
  const [pinned, setPinned] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(path, { body: { content, pinned } });
      setContent("");
      setPinned(false);
      router.refresh();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-2">
      <label htmlFor="memory-content" className="sr-only">
        {t("workforce.memory.add")}
      </label>
      <Textarea id="memory-content" rows={2} maxLength={1000} required placeholder={t("workforce.memory.placeholder")} value={content} onChange={(e) => setContent(e.target.value)} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} />
          {t("workforce.memory.pin")}
        </label>
        <Button type="submit" size="sm" disabled={busy || !content.trim()}>
          {t("workforce.memory.add")}
        </Button>
      </div>
      <FormError error={error} />
    </form>
  );
}
