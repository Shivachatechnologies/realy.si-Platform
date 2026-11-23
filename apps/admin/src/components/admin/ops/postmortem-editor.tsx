"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { useT } from "@/i18n/client";
import { ActionDialog, useAdminAction } from "../action-dialog";

/**
 * Markdown postmortem editor: save as draft or publish (reason audited). Unsaved edits are guarded with the
 * browser's leave-page prompt.
 */
export function PostmortemEditor({ incidentId, initial, state, readOnly, template }: { incidentId: string; initial: string; state: string; readOnly: boolean; template: string }) {
  const t = useT();
  const run = useAdminAction({ success: t("admin.incidents.postmortem.saved") });
  const [text, setText] = useState(initial || "");
  const dirty = text !== (initial || "");
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const save = (next: "draft" | "published") => (reason: string) => run(`/api/v1/admin/incidents/${incidentId}/postmortem`, "POST", { postmortem: text, state: next, reason });
  return (
    <div className="grid gap-2">
      <Textarea
        aria-label={t("admin.incidents.postmortem.title")}
        className="min-h-64 font-mono text-xs"
        maxLength={50_000}
        readOnly={readOnly}
        value={text}
        placeholder={template}
        onChange={(e) => setText(e.target.value)}
      />
      {readOnly ? null : (
        <div className="flex flex-wrap items-center justify-end gap-2">
          {!text.trim() ? (
            <Button size="sm" variant="ghost" onClick={() => setText(template)}>
              {t("admin.incidents.postmortem.useTemplate")}
            </Button>
          ) : null}
          {dirty ? <span className="me-auto text-xs text-warning">{t("admin.incidents.postmortem.unsaved")}</span> : null}
          <ActionDialog trigger={<Button size="sm" variant="secondary">{t("admin.incidents.postmortem.saveDraft")}</Button>} title={t("admin.incidents.postmortem.saveDraft")} confirmLabel={t("admin.incidents.postmortem.saveDraft")} onConfirm={(reason) => save("draft")(reason)} />
          <ActionDialog
            trigger={
              <Button size="sm" disabled={!text.trim()}>
                {state === "published" ? t("admin.incidents.postmortem.republish") : t("admin.incidents.postmortem.publish")}
              </Button>
            }
            title={t("admin.incidents.postmortem.publish")}
            confirmLabel={t("admin.incidents.postmortem.publish")}
            onConfirm={(reason) => save("published")(reason)}
          />
        </div>
      )}
    </div>
  );
}
