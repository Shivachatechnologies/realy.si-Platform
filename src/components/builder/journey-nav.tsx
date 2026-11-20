"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/form-error";
import { useI18n } from "@/i18n/client";
import { api } from "@/lib/api-client";

/** Back / next between journey stages; the stage is saved server-side so the founder resumes here. */
export function JourneyNav({ stage, total, nextLabel, finishHref }: { stage: number; total: number; nextLabel: string; finishHref?: string }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  async function go(to: number, completed = false) {
    setBusy(true);
    setError(null);
    try {
      await api("/api/v1/me/onboarding", { method: "PATCH", body: { stage: Math.min(total, Math.max(1, to)), ...(completed ? { completed: true } : {}) } });
      router.push(completed && finishHref ? finishHref : `/${locale}/onboarding?stage=${to}`);
      router.refresh();
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {stage > 3 ? (
          <Button variant="ghost" disabled={busy} onClick={() => go(stage - 1)}>
            <ArrowLeft aria-hidden className="rtl:rotate-180" />
            {t("common.previous")}
          </Button>
        ) : (
          <span />
        )}
        <Button size="lg" variant="gradient" loading={busy} onClick={() => (stage >= total ? go(total, true) : go(stage + 1))}>
          {nextLabel}
          <ArrowRight aria-hidden className="rtl:rotate-180" />
        </Button>
      </div>
      <FormError error={error} />
    </div>
  );
}
