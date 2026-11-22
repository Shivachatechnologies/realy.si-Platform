"use client";

import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/form-error";
import { useT } from "@/i18n/client";
import { api } from "@/lib/api-client";
import { useAction } from "./ui";

/** Asks the AI CFO to write the monthly pack for `month` (an agent task) and opens the task. */
export function MonthlyPackButton({ base, locale, month }: { base: string; locale: string; month: string }) {
  const t = useT();
  const router = useRouter();
  const { busy, error, run } = useAction();
  return (
    <div className="grid gap-2">
      <Button type="button" disabled={busy} onClick={() => void run(() => api<{ id: string }>(`${base}/monthly-pack`, { body: { month } }), (task) => router.push(`/${locale}/tasks/${task.id}`))}>
        <Sparkles aria-hidden />
        {t("finance.monthlyPack.ask")}
      </Button>
      <FormError error={error} />
    </div>
  );
}
