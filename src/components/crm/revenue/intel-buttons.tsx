"use client";

import { Gauge, Radar, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/form-error";
import { useT } from "@/i18n/client";
import { api } from "@/lib/api-client";
import { useAction } from "../kit";

/** Run a provider-backed action (research, AI qualification, apply answers) and refresh the page with real results. */
export function IntelButton({ url, kind, again = false }: { url: string; kind: "enrich" | "qualify" | "apply"; again?: boolean }) {
  const t = useT();
  const { busy, error, run } = useAction();
  const Icon = kind === "enrich" ? Radar : kind === "qualify" ? Gauge : Wand2;
  return (
    <span className="inline-flex flex-col gap-1">
      <Button type="button" size="sm" variant={kind === "apply" ? "secondary" : "luminous"} disabled={busy} aria-busy={busy} onClick={() => void run(() => api(url, { body: {} }))}>
        <Icon aria-hidden />
        {busy ? t("crm.rev.working") : t(`crm.rev.intel.${kind}${again ? "Again" : ""}`)}
      </Button>
      <FormError error={error} />
    </span>
  );
}
