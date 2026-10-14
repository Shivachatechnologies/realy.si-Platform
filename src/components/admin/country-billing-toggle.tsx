"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/client";
import { api } from "@/lib/api-client";
import { ReasonDialog } from "./reason-dialog";

export function CountryBillingToggle({ code, name, enabled }: { code: string; name: string; enabled: boolean }) {
  const t = useT();
  const router = useRouter();
  const label = enabled ? t("admin.countries.disableBilling") : t("admin.countries.enableBilling");
  return (
    <ReasonDialog
      trigger={<Button size="sm" variant="ghost">{label}</Button>}
      title={`${label} · ${name}`}
      confirmLabel={label}
      onConfirm={async (reason) => {
        await api(`/api/v1/admin/countries/${code}`, { method: "PATCH", body: { billingEnabled: !enabled, reason } });
        router.refresh();
      }}
    />
  );
}
