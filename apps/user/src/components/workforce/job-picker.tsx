"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/form-error";
import { useI18n, useT } from "@/i18n/client";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";

export interface JobOption {
  job: string;
  profileKey: string;
  name: string;
  recommended?: boolean;
  staffed?: boolean;
}

/** Plain-language hiring: "Which job would you like your AI employee to handle?" → creates the employee and opens its setup. */
export function JobPicker({ apiBase, jobs }: { apiBase: string; jobs: JobOption[] }) {
  const t = useT();
  const { locale } = useI18n();
  const router = useRouter();
  const [picked, setPicked] = useState(jobs.find((j) => j.recommended && !j.staffed)?.job ?? jobs[0]?.job ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const job = jobs.find((j) => j.job === picked);

  async function hire() {
    if (!job) return;
    setBusy(true);
    setError(null);
    try {
      const e = await api<{ id: string }>(`${apiBase}/workforce/employees`, { body: { profileKey: job.profileKey, name: job.name, jobTitle: t(`workforce.jobs.${job.job}.title`), activate: false } });
      router.push(`/${locale}/workforce/${e.id}/setup`);
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-3">
      <div role="radiogroup" aria-label={t("workforce.jobs.question")} className="grid gap-2 stagger sm:grid-cols-2 xl:grid-cols-4">
        {jobs.map((j) => (
          <button
            key={j.job}
            type="button"
            role="radio"
            aria-checked={picked === j.job}
            onClick={() => setPicked(j.job)}
            className={cn("hover-lift grid content-start gap-1 rounded-lg border bg-surface p-3 text-start text-sm transition-colors", picked === j.job ? "border-primary ring-2 ring-primary/30" : "hover:bg-muted/40")}
          >
            <span className="flex items-center justify-between gap-2 font-medium">
              {t(`workforce.jobs.${j.job}.title`)}
              {picked === j.job ? <Check aria-hidden className="size-4 text-primary" /> : null}
            </span>
            <span className="text-xs text-muted-foreground">{t(`workforce.jobs.${j.job}.example`)}</span>
            <span className="flex flex-wrap gap-1 pt-1 text-[11px]">
              {j.recommended ? <span className="rounded-full bg-primary/10 px-2 text-primary">{t("workforce.jobs.recommended")}</span> : null}
              {j.staffed ? <span className="rounded-full bg-muted px-2 text-muted-foreground">{t("workforce.jobs.staffed")}</span> : null}
            </span>
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" disabled={!job || busy} onClick={hire}>
          {busy ? t("common.creating") : t("workforce.jobs.hire")}
        </Button>
        <span className="text-xs text-muted-foreground">{t("workforce.jobs.after")}</span>
      </div>
      <FormError error={error} />
    </div>
  );
}
