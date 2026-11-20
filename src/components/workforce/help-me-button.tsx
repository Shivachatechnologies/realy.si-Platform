"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/form-error";
import { useI18n, useT } from "@/i18n/client";
import { api } from "@/lib/api-client";

/**
 * "Help me do this": creates a real AI task (an AI employee if given, else the role) with the page's context, then
 * opens the task page where progress and the result appear. Nothing is simulated.
 */
export function HelpMeButton({
  apiBase,
  profile,
  aiEmployeeId,
  title,
  instructions,
  label,
  variant = "secondary",
}: {
  apiBase: string;
  profile: string;
  aiEmployeeId?: string | null;
  title: string;
  instructions: string;
  label?: string;
  variant?: "default" | "secondary" | "ghost";
}) {
  const t = useT();
  const { locale } = useI18n();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  async function run() {
    setBusy(true);
    setError(null);
    try {
      const task = await api<{ id: string }>(`${apiBase}/tasks`, { body: { ...(aiEmployeeId ? { aiEmployeeId } : { profile }), title, instructions } });
      router.push(`/${locale}/tasks/${task.id}`);
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }
  return (
    <span className="inline-grid gap-1">
      <Button type="button" size="sm" variant={variant} disabled={busy} onClick={run}>
        <Sparkles aria-hidden />
        {busy ? t("workforce.help.starting") : (label ?? t("workforce.help.action"))}
      </Button>
      {error ? <FormError error={error} /> : null}
    </span>
  );
}
