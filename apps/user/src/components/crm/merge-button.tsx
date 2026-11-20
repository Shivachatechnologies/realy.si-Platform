"use client";

import { GitMerge } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/form-error";
import { useT } from "@/i18n/client";
import { api } from "@/lib/api-client";
import { useAction } from "./lead-forms";

/** Merge another (duplicate) contact/account into the current one. */
export function MergeRecordButton({ url, secondaryId, label }: { url: string; secondaryId: string; label: string }) {
  const t = useT();
  const { busy, error, run } = useAction();
  return (
    <span className="inline-flex flex-col gap-1">
      <Button
        size="sm"
        variant="secondary"
        disabled={busy}
        onClick={() => {
          if (window.confirm(t("crm.mergeRecordConfirm", { name: label }))) void run(() => api(url, { body: { secondaryId } }));
        }}
      >
        <GitMerge aria-hidden />
        {t("crm.mergeIntoThis")}
      </Button>
      <FormError error={error} />
    </span>
  );
}
