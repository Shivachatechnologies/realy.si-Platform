"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormError } from "@/components/form-error";
import { useT } from "@/i18n/client";
import { api } from "@/lib/api-client";
import { useAction } from "./ui";

/** Starts an AI CFO task about the dashboard and opens it. */
export function InsightsButton({ base, locale }: { base: string; locale: string }) {
  const t = useT();
  const router = useRouter();
  const [focus, setFocus] = useState("");
  const { busy, error, run } = useAction();
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap gap-2">
        <Input value={focus} maxLength={1000} onChange={(e) => setFocus(e.target.value)} placeholder={t("finance.dashboard.insightsFocus")} aria-label={t("finance.dashboard.insightsFocus")} className="min-w-0 flex-1" />
        <Button type="button" disabled={busy} onClick={() => void run(() => api<{ id: string }>(`${base}/insights`, { body: { focus: focus.trim() || undefined } }), (task) => router.push(`/${locale}/tasks/${task.id}`))}>
          <Sparkles aria-hidden />
          {t("finance.dashboard.insights")}
        </Button>
      </div>
      <FormError error={error} />
    </div>
  );
}
