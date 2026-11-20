"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { FormError } from "@/components/form-error";
import { useT } from "@/i18n/client";
import { api } from "@/lib/api-client";
import { useAction } from "./lead-forms";

/** "I'll explore on my own": hides the journey as the default Sales view (it stays available under Start selling). */
export function DismissJourneyButton({ base, locale }: { base: string; locale: string }) {
  const t = useT();
  const router = useRouter();
  const { busy, error, run } = useAction();
  return (
    <span className="inline-flex flex-col gap-1">
      <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => void run(() => api(`${base}/crm/journey`, { method: "PATCH", body: { dismissed: true } }), () => router.push(`/${locale}/sales`))}>
        {t("sales.journey.dismiss")}
      </Button>
      <FormError error={error} />
    </span>
  );
}

export function RestartJourneyButton({ base, locale }: { base: string; locale: string }) {
  const t = useT();
  const router = useRouter();
  const { busy, error, run } = useAction();
  return (
    <span className="inline-flex flex-col gap-1">
      <Button
        type="button"
        size="sm"
        variant="secondary"
        disabled={busy}
        onClick={() => {
          if (window.confirm(t("sales.journey.restartConfirm"))) void run(() => api(`${base}/crm/journey`, { method: "PATCH", body: { restart: true } }), () => router.push(`/${locale}/sales/start`));
        }}
      >
        <RotateCcw aria-hidden />
        {t("sales.journey.restart")}
      </Button>
      <FormError error={error} />
    </span>
  );
}

/** Edit the saved ideal customer profile (CRM settings). */
export function IcpEditor({ base, initial }: { base: string; initial: string }) {
  const t = useT();
  const [icp, setIcp] = useState(initial);
  const [saved, setSaved] = useState(false);
  const { busy, error, run } = useAction();
  return (
    <form
      className="grid gap-2 p-4"
      onSubmit={(e) => {
        e.preventDefault();
        setSaved(false);
        void run(() => api(`${base}/crm/journey/actions`, { body: { action: "icp_save", icp: icp.trim(), keepStep: true } }), () => setSaved(true));
      }}
    >
      <Textarea aria-label={t("crm.settings.icpTitle")} rows={6} maxLength={8000} value={icp} placeholder={t("crm.settings.icpPlaceholder")} onChange={(e) => setIcp(e.target.value)} />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" loading={busy} disabled={icp.trim().length < 3}>
          {t("common.save")}
        </Button>
        {saved ? <span className="text-xs text-success">{t("crm.settings.icpSaved")}</span> : null}
      </div>
      <FormError error={error} />
    </form>
  );
}
