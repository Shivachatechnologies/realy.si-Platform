"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/client";
import { api } from "@/lib/api-client";

export function MarkReadButton({ organizationId }: { organizationId: string }) {
  const t = useT();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      size="sm"
      variant="ghost"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await api("/api/v1/me/notifications/read", { body: { organizationId } });
          router.refresh();
        } finally {
          setBusy(false);
        }
      }}
    >
      <CheckCheck aria-hidden />
      {t("notifications.markAllRead")}
    </Button>
  );
}
