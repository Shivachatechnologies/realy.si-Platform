"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/client";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { ActionButton } from "./client";

/** One notification: opening it marks it read. */
export function NotificationLink({ organizationId, id, href, text, unread }: { organizationId: string; id: string; href: string; text: string; unread: boolean }) {
  const t = useT();
  const router = useRouter();
  const markRead = () => api("/api/v1/me/notifications/read", { body: { organizationId, ids: [id] } }).catch(() => undefined);
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <Link
        href={href}
        className={cn("min-w-0 flex-1 truncate hover:underline", unread && "font-medium")}
        onClick={() => {
          if (unread) void markRead();
        }}
      >
        {text}
      </Link>
      {unread ? (
        <Button type="button" size="sm" variant="ghost" aria-label={t("communication.notifications.markRead")} onClick={() => void markRead().then(() => router.refresh())}>
          <Check />
        </Button>
      ) : null}
    </div>
  );
}

export function MarkAllRead({ organizationId }: { organizationId: string }) {
  const t = useT();
  return (
    <ActionButton path="/api/v1/me/notifications/read" body={{ organizationId }}>
      {t("notifications.markAllRead")}
    </ActionButton>
  );
}
