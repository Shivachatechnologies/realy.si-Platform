"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/form-error";
import { useI18n, useT } from "@/i18n/client";
import { api } from "@/lib/api-client";

export function DeleteDocumentButton({ organizationId, companyId, documentId }: { organizationId: string; companyId: string; documentId: string }) {
  const t = useT();
  const { locale } = useI18n();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  async function remove() {
    if (!window.confirm(t("brain.confirmDelete"))) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/api/v1/organizations/${organizationId}/companies/${companyId}/brain/documents/${documentId}`, { method: "DELETE" });
      router.push(`/${locale}/brain`);
      router.refresh();
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  }
  return (
    <div className="grid justify-items-end gap-1">
      <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={remove}>
        <Trash2 aria-hidden />
        {t("brain.delete")}
      </Button>
      <FormError error={error} />
    </div>
  );
}
