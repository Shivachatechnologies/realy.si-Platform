"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Lock, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select, Textarea } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { FormError } from "@/components/form-error";
import { useT } from "@/i18n/client";
import { api } from "@/lib/api-client";
import { ActionDialog, useAdminAction } from "../action-dialog";

/** Reply to the customer (emailed) or add an internal note. Double submit is prevented while the request runs. */
export function ReplyComposer({ ticketId, closed }: { ticketId: string; closed: boolean }) {
  const t = useT();
  const toast = useToast();
  const router = useRouter();
  const [text, setText] = useState("");
  const [internal, setInternal] = useState(closed);
  const [status, setStatus] = useState("PENDING_CUSTOMER");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  return (
    <form
      className="grid gap-2 p-4"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!text.trim() || busy) return;
        setBusy(true);
        setError(null);
        try {
          const r = await api<{ email: string | null }>(`/api/v1/admin/support/${ticketId}/reply`, { method: "POST", body: { body: text.trim(), internal, ...(internal ? {} : { status }) } });
          setText("");
          if (internal) toast.success(t("admin.support.noteAdded"));
          else if (r.email === "SENT") toast.success(t("admin.support.replySentEmailed"));
          else toast.toast({ tone: "warning", title: t("admin.support.replySentNoEmail", { status: r.email ?? "—" }) });
          router.refresh();
        } catch (err) {
          setError(err);
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="flex gap-1" role="tablist" aria-label={t("admin.support.composer")}>
        <Button type="button" size="sm" variant={internal ? "ghost" : "secondary"} aria-pressed={!internal} disabled={closed} onClick={() => setInternal(false)}>
          <Send />
          {t("admin.support.reply")}
        </Button>
        <Button type="button" size="sm" variant={internal ? "secondary" : "ghost"} aria-pressed={internal} onClick={() => setInternal(true)}>
          <Lock />
          {t("admin.support.internalNote")}
        </Button>
      </div>
      <Field label={internal ? t("admin.support.internalNote") : t("admin.support.reply")} htmlFor={`reply-${ticketId}`} hint={internal ? t("admin.support.internalHint") : t("admin.support.replyHint")}>
        <Textarea id={`reply-${ticketId}`} value={text} onChange={(e) => setText(e.target.value)} rows={5} maxLength={10_000} className={internal ? "border-warning/50 bg-warning/5" : undefined} />
      </Field>
      <div className="flex flex-wrap items-center justify-end gap-2">
        {!internal ? (
          <Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label={t("admin.support.statusAfter")} className="w-auto">
            {(["PENDING_CUSTOMER", "OPEN", "ON_HOLD", "SOLVED"] as const).map((s) => (
              <option key={s} value={s}>
                {t("admin.support.thenStatus", { status: t(`admin.support.statuses.${s}`) })}
              </option>
            ))}
          </Select>
        ) : null}
        <Button type="submit" disabled={busy || !text.trim()}>
          {busy ? t("common.saving") : internal ? t("admin.support.addNote") : t("admin.support.sendReply")}
        </Button>
      </div>
      <FormError error={error} />
    </form>
  );
}

/** Link to an incident (E's platform incident id) / organization and edit tags. */
export function LinkTicket({ ticketId, incidentId, organizationId, tags }: { ticketId: string; incidentId: string | null; organizationId: string | null; tags: string[] }) {
  const t = useT();
  const run = useAdminAction({ success: t("admin.settings.kit.saved") });
  const [incident, setIncident] = useState(incidentId ?? "");
  const [org, setOrg] = useState(organizationId ?? "");
  const [tagText, setTagText] = useState(tags.join(", "));
  const uuid = (v: string) => v === "" || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v.trim());
  return (
    <ActionDialog
      trigger={
        <Button size="sm" variant="secondary">
          {t("admin.support.links")}
        </Button>
      }
      title={t("admin.support.linksTitle")}
      description={t("admin.support.linksHint")}
      confirmLabel={t("common.save")}
      canSubmit={uuid(incident) && uuid(org)}
      onConfirm={(reason) =>
        run(`/api/v1/admin/support/${ticketId}/link`, "PUT", {
          incidentId: incident.trim() || null,
          organizationId: org.trim() || null,
          tags: tagText
            .split(",")
            .map((s) => s.trim().toLowerCase())
            .filter(Boolean),
          reason,
        })
      }
    >
      <Field label={t("admin.support.incidentId")} htmlFor={`inc-${ticketId}`}>
        <Input id={`inc-${ticketId}`} value={incident} onChange={(e) => setIncident(e.target.value)} className="font-mono" />
      </Field>
      <Field label={t("admin.support.organizationId")} htmlFor={`org-${ticketId}`}>
        <Input id={`org-${ticketId}`} value={org} onChange={(e) => setOrg(e.target.value)} className="font-mono" />
      </Field>
      <Field label={t("admin.support.tags")} htmlFor={`tags-${ticketId}`}>
        <Input id={`tags-${ticketId}`} value={tagText} onChange={(e) => setTagText(e.target.value)} />
      </Field>
    </ActionDialog>
  );
}
