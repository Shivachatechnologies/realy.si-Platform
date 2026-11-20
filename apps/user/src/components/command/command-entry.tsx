"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Command } from "lucide-react";
import { useT } from "@/i18n/client";

/** Hero entry to the AI Command workspace (/command, ⌘J): the typed request is handed over as ?q=. */
export function CommandEntry({ locale }: { locale: string }) {
  const t = useT();
  const router = useRouter();
  const [q, setQ] = useState("");
  function submit(e: FormEvent) {
    e.preventDefault();
    router.push(`/${locale}/command${q.trim() ? `?q=${encodeURIComponent(q.trim())}&run=1` : ""}`);
  }
  return (
    <form onSubmit={submit} role="search" aria-label={t("dna.command.entryLabel")} className="group flex items-center gap-3 rounded-2xl border bg-surface/80 px-4 py-3 shadow-float backdrop-blur transition-shadow focus-within:border-ring focus-within:shadow-glow">
      <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-xl bg-brand-gradient text-primary-foreground shadow-glow">
        <Command className="size-4" />
      </span>
      <label htmlFor="command-entry" className="sr-only">
        {t("dna.command.entryLabel")}
      </label>
      <input id="command-entry" value={q} onChange={(e) => setQ(e.target.value)} maxLength={500} placeholder={t("dna.command.entryPlaceholder")} className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground" />
      <kbd className="hidden rounded-md border px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground sm:inline">⌘J</kbd>
      <button type="submit" className="inline-flex items-center gap-1.5 rounded-xl bg-foreground px-3 py-2 text-sm font-medium text-background transition-transform hover:scale-[1.03]">
        {t("dna.command.entryGo")}
        <ArrowRight className="size-4 rtl:-scale-x-100" aria-hidden />
      </button>
    </form>
  );
}
