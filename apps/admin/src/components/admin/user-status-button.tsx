"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ReasonDialog } from "@/components/admin/reason-dialog";
import { useT } from "@/i18n/client";
import { api } from "@/lib/api-client";

export function UserStatusButton({ userId, email, status }: { userId: string; email: string; status: "ACTIVE" | "SUSPENDED" }) {
  const t = useT();
  const router = useRouter();
  const next = status === "ACTIVE" ? "SUSPENDED" : "ACTIVE";
  const label = next === "SUSPENDED" ? t("admin.users.suspend") : t("admin.users.reactivate");
  return (
    <ReasonDialog
      trigger={
        <Button size="sm" variant={next === "SUSPENDED" ? "secondary" : "default"}>
          {label}
        </Button>
      }
      title={`${label}: ${email}`}
      description={next === "SUSPENDED" ? t("admin.users.suspendHint") : undefined}
      confirmLabel={label}
      onConfirm={async (reason) => {
        await api(`/api/v1/admin/users/${userId}/status`, { method: "PUT", body: { status: next, reason } });
        router.refresh();
      }}
    />
  );
}
