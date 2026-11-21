"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/form-error";
import { useI18n } from "@/i18n/client";
import { api } from "@/lib/api-client";

/**
 * "Do this": hands an insight to AI Command as a plain-language command — it is understood, planned and delegated to
 * the company's AI employees as real tasks — then opens the command so the person can follow every stage.
 */
export function DoThisButton({ base, command, disabledReason, size = "sm" }: { base: string; command: string; disabledReason?: string | null; size?: "sm" | "default" }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const s = await api<{ id: string }>(`${base}/guide/command`, { body: { text: command, locale } });
      router.push(`/${locale}/command?s=${s.id}`);
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };
  return (
    <span className="grid justify-items-start gap-1">
      <Button type="button" size={size} variant="secondary" loading={busy} disabled={!!disabledReason} title={disabledReason ?? command} onClick={() => void run()}>
        {busy ? null : <Sparkles aria-hidden />}
        {t("analytics.health.doThis")}
      </Button>
      {disabledReason ? <span className="text-[11px] text-muted-foreground">{disabledReason}</span> : null}
      {error ? <FormError error={error} /> : null}
    </span>
  );
}
