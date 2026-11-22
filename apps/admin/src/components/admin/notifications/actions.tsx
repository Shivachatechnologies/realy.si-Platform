"use client";

import { useState } from "react";
import { CheckCheck, Mail, MailOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/client";
import { useAdminAction } from "../action-dialog";
import { useDataTableSelection } from "../data-table/data-table";

/** "Mark all read" (every visible unread notification; own read receipts only, nothing audited). */
export function MarkAllRead() {
  const t = useT();
  const run = useAdminAction({ toastError: true });
  const [busy, setBusy] = useState(false);
  return (
    <Button
      size="sm"
      variant="secondary"
      disabled={busy}
      aria-busy={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await run("/api/v1/admin/notifications/read", "POST", { all: true }, { success: t("admin.notifications.markedAll") });
        } catch {
          /* toasted */
        } finally {
          setBusy(false);
        }
      }}
    >
      <CheckCheck aria-hidden />
      {t("admin.notifications.markAllRead")}
    </Button>
  );
}

/** Bulk bar of the notifications table: mark the selected rows read or unread. */
export function MarkSelected() {
  const t = useT();
  const { ids, clear } = useDataTableSelection();
  const run = useAdminAction({ toastError: true });
  const [busy, setBusy] = useState(false);
  const mark = async (read: boolean) => {
    setBusy(true);
    try {
      await run("/api/v1/admin/notifications/read", "POST", { ids, read }, { success: t("admin.notifications.marked", { count: ids.length }) });
      clear();
    } catch {
      /* toasted */
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Button size="sm" variant="secondary" disabled={busy || !ids.length} onClick={() => mark(true)}>
        <MailOpen aria-hidden />
        {t("admin.notifications.markRead")}
      </Button>
      <Button size="sm" variant="ghost" disabled={busy || !ids.length} onClick={() => mark(false)}>
        <Mail aria-hidden />
        {t("admin.notifications.markUnread")}
      </Button>
    </>
  );
}
