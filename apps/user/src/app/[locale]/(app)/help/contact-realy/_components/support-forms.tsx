"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { FormError } from "@/components/form-error";
import { useT } from "@/i18n/client";
import { api } from "@/lib/api-client";

const CATEGORIES = ["billing", "bug", "account", "ai", "integration", "other"] as const;

/** "Contact Realy support": a new ticket to the Realy team (not to a company's own helpdesk). */
export function NewTicketForm({ organizations, locale }: { organizations: { id: string; name: string }[]; locale: string }) {
  const t = useT();
  const router = useRouter();
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [category, setCategory] = useState<string>("other");
  const [priority, setPriority] = useState("NORMAL");
  const [organizationId, setOrganizationId] = useState(organizations[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const ok = subject.trim().length >= 3 && body.trim().length >= 1;
  return (
    <form
      className="grid gap-3"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!ok || busy) return;
        setBusy(true);
        setError(null);
        try {
          const r = await api<{ id: string }>("/api/v1/platform-support/tickets", { method: "POST", body: { subject: subject.trim(), body: body.trim(), category, priority, organizationId: organizationId || null } });
          router.push(`/${locale}/help/contact-realy/${r.id}`);
        } catch (err) {
          setError(err);
          setBusy(false);
        }
      }}
    >
      <Field label={t("platformSupport.subject")} htmlFor="ps-subject">
        <Input id="ps-subject" value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={200} required />
      </Field>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={t("platformSupport.category")} htmlFor="ps-category">
          <Select id="ps-category" value={category} onChange={(e) => setCategory(e.target.value)}>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {t(`platformSupport.categories.${c}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("platformSupport.priority")} htmlFor="ps-priority" hint={t("platformSupport.priorityHint")}>
          <Select id="ps-priority" value={priority} onChange={(e) => setPriority(e.target.value)}>
            {(["LOW", "NORMAL", "HIGH"] as const).map((p) => (
              <option key={p} value={p}>
                {t(`platformSupport.priorities.${p}`)}
              </option>
            ))}
          </Select>
        </Field>
        {organizations.length ? (
          <Field label={t("platformSupport.organization")} htmlFor="ps-org">
            <Select id="ps-org" value={organizationId} onChange={(e) => setOrganizationId(e.target.value)}>
              {organizations.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
              <option value="">{t("platformSupport.noOrganization")}</option>
            </Select>
          </Field>
        ) : null}
      </div>
      <Field label={t("platformSupport.message")} htmlFor="ps-body" hint={t("platformSupport.messageHint")}>
        <Textarea id="ps-body" value={body} onChange={(e) => setBody(e.target.value)} rows={6} maxLength={10_000} required />
      </Field>
      <FormError error={error} />
      <div className="flex justify-end">
        <Button type="submit" disabled={!ok || busy}>
          <Send />
          {busy ? t("common.creating") : t("platformSupport.submit")}
        </Button>
      </div>
    </form>
  );
}

/** Reply on my ticket, or mark it solved. Closed tickets cannot be reopened (open a new one). */
export function TicketReply({ ticketId, status }: { ticketId: string; status: string }) {
  const t = useT();
  const router = useRouter();
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  if (status === "CLOSED") return <Notice tone="info">{t("platformSupport.closedNotice")}</Notice>;
  const post = async (path: string, payload: unknown) => {
    setBusy(true);
    setError(null);
    try {
      await api(path, { method: "POST", body: payload });
      setBody("");
      router.refresh();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className="grid gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (body.trim() && !busy) void post(`/api/v1/platform-support/tickets/${ticketId}/messages`, { body: body.trim() });
      }}
    >
      <Field label={t("platformSupport.reply")} htmlFor="ps-reply">
        <Textarea id="ps-reply" value={body} onChange={(e) => setBody(e.target.value)} rows={4} maxLength={10_000} />
      </Field>
      <FormError error={error} />
      <div className="flex flex-wrap justify-end gap-2">
        {status !== "SOLVED" ? (
          <Button type="button" variant="secondary" disabled={busy} onClick={() => void post(`/api/v1/platform-support/tickets/${ticketId}/solve`, {})}>
            {t("platformSupport.markSolved")}
          </Button>
        ) : null}
        <Button type="submit" disabled={busy || !body.trim()}>
          <Send />
          {busy ? t("common.saving") : t("platformSupport.send")}
        </Button>
      </div>
    </form>
  );
}
