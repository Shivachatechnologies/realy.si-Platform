"use client";

import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/form-error";
import { useT } from "@/i18n/client";
import { api } from "@/lib/api-client";
import { useAction } from "./actions";

/** Asks the AI project manager to propose the execution of an objective, then opens the task. */
export function PlanObjectiveButton({ base, locale, objectiveId }: { base: string; locale: string; objectiveId: string }) {
  const t = useT();
  const router = useRouter();
  const { busy, error, run } = useAction();
  return (
    <div className="grid gap-1">
      <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => void run(() => api<{ id: string }>(`${base}/work/execution/plan`, { body: { objectiveId } }), (task) => router.push(`/${locale}/tasks/${task.id}`))}>
        <Sparkles aria-hidden />
        {t("work.execution.plan")}
      </Button>
      <FormError error={error} />
    </div>
  );
}
