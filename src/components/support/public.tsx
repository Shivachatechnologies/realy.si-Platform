"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { FormError } from "@/components/form-error";
import { useI18n } from "@/i18n/client";
import { api } from "@/lib/api-client";

/** Customer reply on the public ticket page (no login). */
export function PublicReplyForm({ token }: { token: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [sent, setSent] = useState(false);
  return (
    <form
      className="grid gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          await api(`/api/v1/public/tickets/${token}/replies`, { body: { body } });
          setBody("");
          setSent(true);
          router.refresh();
        } catch (err) {
          setError(err);
        } finally {
          setBusy(false);
        }
      }}
    >
      <Textarea rows={5} required maxLength={10000} value={body} onChange={(e) => { setBody(e.target.value); setSent(false); }} placeholder={t("support.public.replyPlaceholder")} aria-label={t("support.public.reply")} />
      <FormError error={error} />
      {sent ? <Notice tone="success">{t("support.public.replySent")}</Notice> : null}
      <div>
        <Button type="submit" disabled={busy || !body.trim()}>
          {t("support.public.sendReply")}
        </Button>
      </div>
    </form>
  );
}

/** Public support form (creates a ticket; rate limited; honeypot). */
export function SupportRequestForm({ companyId }: { companyId: string }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [f, setF] = useState({ name: "", email: "", subject: "", description: "", website: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState<{ number: number; token: string } | null>(null);
  if (done) {
    return (
      <Notice tone="success">
        {t("support.public.created", { number: done.number })}{" "}
        <button type="button" className="underline" onClick={() => router.push(`/${locale}/t/${done.token}`)}>
          {t("support.public.viewTicket")}
        </button>
      </Notice>
    );
  }
  return (
    <form
      className="grid gap-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          setDone(await api<{ number: number; token: string }>(`/api/v1/public/support/${companyId}/tickets?locale=${locale}`, { body: f }));
        } catch (err) {
          setError(err);
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("support.public.name")} htmlFor="sf-name">
          <Input id="sf-name" required maxLength={200} autoComplete="name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </Field>
        <Field label={t("support.public.email")} htmlFor="sf-email">
          <Input id="sf-email" type="email" required maxLength={254} autoComplete="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
        </Field>
      </div>
      <Field label={t("support.ticket.subject")} htmlFor="sf-subject">
        <Input id="sf-subject" required maxLength={300} value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} />
      </Field>
      <Field label={t("support.public.describe")} htmlFor="sf-desc">
        <Textarea id="sf-desc" required rows={6} maxLength={10000} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
      </Field>
      <div aria-hidden className="absolute -start-[9999px] h-0 w-0 overflow-hidden">
        <input name="website" tabIndex={-1} autoComplete="off" value={f.website} onChange={(e) => setF({ ...f, website: e.target.value })} />
      </div>
      <FormError error={error} />
      <div>
        <Button type="submit" disabled={busy}>
          {t("support.public.submit")}
        </Button>
      </div>
    </form>
  );
}
