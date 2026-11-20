"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Send, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { FormError } from "@/components/form-error";
import { useI18n, useT } from "@/i18n/client";
import { api } from "@/lib/api-client";
import { ActionButton, useAction } from "./client";

export interface TemplateLite {
  id: string;
  name: string;
  subject: string;
  body: string;
}

export interface MailboxLite {
  id: string;
  address: string;
  provider: string;
  connected: boolean;
}

const splitEmails = (s: string) =>
  s
    .split(/[,;\s]+/)
    .map((x) => x.trim())
    .filter(Boolean);

/** Shows the truthful delivery outcome of a send. */
export function SendStatus({ status }: { status: string | null }) {
  const t = useT();
  if (!status) return null;
  return <Notice tone={status === "SENT" ? "success" : status === "FAILED" ? "danger" : "warning"}>{t(`communication.inbox.sendStatus.${status}`)}</Notice>;
}

function ContactPicker({ base, value, onChange }: { base: string; value: string; onChange: (id: string, label?: string) => void }) {
  const t = useT();
  const [q, setQ] = useState("");
  const [options, setOptions] = useState<{ id: string; firstName: string; lastName: string | null; email: string | null }[]>([]);
  useEffect(() => {
    const h = setTimeout(() => {
      void api<{ data: typeof options }>(`${base}/comms/contacts?q=${encodeURIComponent(q)}`)
        .then((r) => setOptions(r.data))
        .catch(() => setOptions([]));
    }, 250);
    return () => clearTimeout(h);
  }, [base, q]);
  return (
    <div className="grid gap-1.5 sm:grid-cols-2">
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("communication.inbox.searchContacts")} aria-label={t("communication.inbox.searchContacts")} />
      <Select value={value} onChange={(e) => onChange(e.target.value)} aria-label={t("communication.inbox.contact")}>
        <option value="">{t("communication.inbox.noContact")}</option>
        {options.map((c) => (
          <option key={c.id} value={c.id}>
            {[c.firstName, c.lastName].filter(Boolean).join(" ")} {c.email ? `<${c.email}>` : ""}
          </option>
        ))}
      </Select>
    </div>
  );
}

export function ComposeForm({ base, locale, mailboxes, templates }: { base: string; locale: string; mailboxes: MailboxLite[]; templates: TemplateLite[] }) {
  const t = useT();
  const router = useRouter();
  const connected = mailboxes.filter((m) => m.connected);
  const [f, setF] = useState({ accountId: connected[0]?.id ?? "", to: "", cc: "", subject: "", body: "", contactId: "" });
  const [status, setStatus] = useState<string | null>(null);
  const { busy, error, run } = useAction();
  return (
    <form
      className="grid gap-3 p-4 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        void run(
          () => api<{ thread: { id: string }; status: string }>(`${base}/comms/email/threads`, { body: { accountId: f.accountId || undefined, to: splitEmails(f.to), cc: splitEmails(f.cc), subject: f.subject, body: f.body, contactId: f.contactId || undefined } }),
          (r) => {
            setStatus(r.status);
            router.push(`/${locale}/communication/inbox/${r.thread.id}`);
          },
        );
      }}
    >
      <Field label={t("communication.inbox.from")} htmlFor="em-from" hint={connected.length ? undefined : t("communication.inbox.fallbackHint")}>
        <Select id="em-from" value={f.accountId} onChange={(e) => setF({ ...f, accountId: e.target.value })}>
          {connected.map((m) => (
            <option key={m.id} value={m.id}>
              {m.address} ({t(`communication.providers.${m.provider}`)})
            </option>
          ))}
          <option value="">{t("communication.inbox.platformMailer")}</option>
        </Select>
      </Field>
      <Field label={t("communication.inbox.template")} htmlFor="em-tpl">
        <Select
          id="em-tpl"
          defaultValue=""
          onChange={(e) => {
            const tpl = templates.find((x) => x.id === e.target.value);
            if (tpl) setF({ ...f, subject: tpl.subject, body: tpl.body });
          }}
        >
          <option value="">{t("communication.inbox.noTemplate")}</option>
          {templates.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("communication.inbox.to")} htmlFor="em-to">
        <Input id="em-to" required value={f.to} placeholder="name@example.com" onChange={(e) => setF({ ...f, to: e.target.value })} />
      </Field>
      <Field label={t("communication.inbox.cc")} htmlFor="em-cc">
        <Input id="em-cc" value={f.cc} onChange={(e) => setF({ ...f, cc: e.target.value })} />
      </Field>
      <Field label={t("communication.inbox.subject")} htmlFor="em-subject" className="sm:col-span-2">
        <Input id="em-subject" required maxLength={300} value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} />
      </Field>
      <Field label={t("communication.inbox.body")} htmlFor="em-body" className="sm:col-span-2">
        <Textarea id="em-body" required rows={8} maxLength={50000} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} />
      </Field>
      <div className="grid gap-1.5 sm:col-span-2">
        <span className="text-sm font-medium">{t("communication.inbox.linkContact")}</span>
        <ContactPicker base={base} value={f.contactId} onChange={(contactId) => setF({ ...f, contactId })} />
      </div>
      <div className="grid gap-2 sm:col-span-2">
        <FormError error={error} />
        <SendStatus status={status} />
        <div>
          <Button type="submit" disabled={busy || !f.to.trim() || !f.subject.trim() || !f.body.trim()}>
            <Send aria-hidden />
            {t("communication.inbox.send")}
          </Button>
        </div>
      </div>
    </form>
  );
}

type QuickDraft = { status: "ok"; body: string; model: string; usedContext: string[] } | { status: "not_connected" } | { status: "paused" } | { status: "failed"; error: string };

/** "Write with AI": an instant reply draft grounded in the thread + CRM/support context, put in the box for editing. */
function AiDraftHelper({ base, threadId, onDraft, hasText }: { base: string; threadId: string; onDraft: (body: string) => void; hasText: boolean }) {
  const { t, locale } = useI18n();
  const [guidance, setGuidance] = useState("");
  const [tone, setTone] = useState<"friendly" | "formal" | "short">("friendly");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<QuickDraft | null>(null);
  const [error, setError] = useState<unknown>(null);
  return (
    <div className="grid gap-2 rounded-lg border border-primary/25 bg-primary/5 p-3">
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_9rem_auto]">
        <Input value={guidance} maxLength={1000} onChange={(e) => setGuidance(e.target.value)} placeholder={t("communication.inbox.quickDraft.guidance")} aria-label={t("communication.inbox.quickDraft.guidance")} />
        <Select value={tone} onChange={(e) => setTone(e.target.value as typeof tone)} aria-label={t("communication.inbox.quickDraft.tone")}>
          {(["friendly", "formal", "short"] as const).map((k) => (
            <option key={k} value={k}>
              {t(`communication.inbox.quickDraft.tones.${k}`)}
            </option>
          ))}
        </Select>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={busy}
          aria-busy={busy}
          onClick={async () => {
            if (hasText && !window.confirm(t("communication.inbox.quickDraft.replaceConfirm"))) return;
            setBusy(true);
            setError(null);
            try {
              const r = await api<QuickDraft>(`${base}/comms/email/threads/${threadId}/quick-draft`, { body: { guidance: guidance || undefined, tone } });
              setResult(r);
              if (r.status === "ok") onDraft(r.body);
            } catch (e) {
              setError(e);
            } finally {
              setBusy(false);
            }
          }}
        >
          <Sparkles aria-hidden /> {busy ? t("communication.inbox.quickDraft.writing") : t("communication.inbox.quickDraft.write")}
        </Button>
      </div>
      <FormError error={error} />
      {result?.status === "ok" ? (
        <p className="text-xs text-muted-foreground">
          {t("communication.inbox.quickDraft.done", { model: result.model })}
          {result.usedContext.length ? ` ${t("communication.inbox.quickDraft.usedContext", { items: result.usedContext.map((k) => t(`communication.inbox.quickDraft.context.${k}`)).join(", ") })}` : ""}
        </p>
      ) : result?.status === "not_connected" ? (
        <Notice tone="warning">
          {t("communication.inbox.quickDraft.notConnected")}{" "}
          <a href={`/${locale}/integrations`} className="font-medium underline">
            {t("communication.connectIntegrations")}
          </a>
        </Notice>
      ) : result?.status === "paused" ? (
        <Notice tone="warning">{t("communication.inbox.quickDraft.paused")}</Notice>
      ) : result?.status === "failed" ? (
        <Notice tone="danger">{t("communication.inbox.quickDraft.failed", { error: result.error })}</Notice>
      ) : (
        <p className="text-xs text-muted-foreground">{t("communication.inbox.quickDraft.hint")}</p>
      )}
    </div>
  );
}

export function ReplyForm({ base, threadId, templates, viaLabel, aiDraft = false }: { base: string; threadId: string; templates: TemplateLite[]; viaLabel: string; aiDraft?: boolean }) {
  const t = useT();
  const [body, setBody] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const { busy, error, run } = useAction();
  return (
    <form
      className="grid gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        void run(
          () => api<{ status: string }>(`${base}/comms/email/threads/${threadId}/reply`, { body: { body } }),
          (r) => {
            setStatus(r.status);
            if (r.status === "SENT") setBody("");
          },
        );
      }}
    >
      {templates.length ? (
        <Select
          defaultValue=""
          aria-label={t("communication.inbox.template")}
          onChange={(e) => {
            const tpl = templates.find((x) => x.id === e.target.value);
            if (tpl) setBody(tpl.body);
          }}
          className="max-w-xs"
        >
          <option value="">{t("communication.inbox.insertTemplate")}</option>
          {templates.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </Select>
      ) : null}
      {aiDraft ? <AiDraftHelper base={base} threadId={threadId} hasText={body.trim().length > 0} onDraft={setBody} /> : null}
      <Textarea rows={6} maxLength={50000} value={body} onChange={(e) => setBody(e.target.value)} placeholder={t("communication.inbox.replyPlaceholder")} aria-label={t("communication.inbox.reply")} />
      <FormError error={error} />
      <SendStatus status={status} />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" disabled={busy || !body.trim()}>
          <Send aria-hidden />
          {t("communication.inbox.sendReply")}
        </Button>
        <span className="text-xs text-muted-foreground">{viaLabel}</span>
      </div>
    </form>
  );
}

export function ThreadContactLink({ base, threadId, current }: { base: string; threadId: string; current: string | null }) {
  const [value, setValue] = useState(current ?? "");
  const { error, run } = useAction();
  return (
    <div className="grid gap-1.5">
      <ContactPicker
        base={base}
        value={value}
        onChange={(id) => {
          setValue(id);
          void run(() => api(`${base}/comms/email/threads/${threadId}`, { method: "PATCH", body: { contactId: id || null } }));
        }}
      />
      <FormError error={error} />
    </div>
  );
}

export function MailboxForm({ base }: { base: string }) {
  const t = useT();
  const [f, setF] = useState({ provider: "gmail", address: "" });
  const { busy, error, run } = useAction();
  return (
    <form
      className="grid gap-2 sm:grid-cols-[10rem_minmax(0,1fr)_auto]"
      onSubmit={(e) => {
        e.preventDefault();
        void run(() => api(`${base}/comms/email/accounts`, { body: f }), () => setF({ ...f, address: "" }));
      }}
    >
      <Select value={f.provider} onChange={(e) => setF({ ...f, provider: e.target.value })} aria-label={t("communication.settings.provider")}>
        <option value="gmail">{t("communication.providers.gmail")}</option>
        <option value="outlook">{t("communication.providers.outlook")}</option>
      </Select>
      <Input type="email" required value={f.address} placeholder="team@company.com" onChange={(e) => setF({ ...f, address: e.target.value })} aria-label={t("communication.settings.address")} />
      <Button type="submit" disabled={busy || !f.address}>
        <Plus aria-hidden />
        {t("communication.settings.addMailbox")}
      </Button>
      <div className="sm:col-span-3">
        <FormError error={error} />
      </div>
    </form>
  );
}

export function SyncMailboxButton({ base, id }: { base: string; id: string }) {
  const t = useT();
  const [stored, setStored] = useState<number | null>(null);
  return (
    <span className="inline-flex items-center gap-2">
      <ActionButton path={`${base}/comms/email/accounts/${id}`} onDone={(r) => setStored((r as { stored: number }).stored)}>
        {t("communication.settings.syncNow")}
      </ActionButton>
      {stored !== null ? <span className="text-xs text-muted-foreground">{t("communication.settings.synced", { count: stored })}</span> : null}
    </span>
  );
}

export function TemplateForm({ base, initial, onDone }: { base: string; initial?: TemplateLite; onDone?: () => void }) {
  const t = useT();
  const [f, setF] = useState({ name: initial?.name ?? "", subject: initial?.subject ?? "", body: initial?.body ?? "" });
  const { busy, error, run } = useAction();
  return (
    <form
      className="grid gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        void run(
          () => (initial ? api(`${base}/comms/email/templates/${initial.id}`, { method: "PATCH", body: f }) : api(`${base}/comms/email/templates`, { body: f })),
          () => {
            if (!initial) setF({ name: "", subject: "", body: "" });
            onDone?.();
          },
        );
      }}
    >
      <div className="grid gap-2 sm:grid-cols-2">
        <Input required maxLength={120} value={f.name} placeholder={t("communication.settings.templateName")} aria-label={t("communication.settings.templateName")} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <Input required maxLength={300} value={f.subject} placeholder={t("communication.inbox.subject")} aria-label={t("communication.inbox.subject")} onChange={(e) => setF({ ...f, subject: e.target.value })} />
      </div>
      <Textarea required rows={5} maxLength={20000} value={f.body} placeholder={t("communication.inbox.body")} aria-label={t("communication.inbox.body")} onChange={(e) => setF({ ...f, body: e.target.value })} />
      <FormError error={error} />
      <div>
        <Button type="submit" size="sm" disabled={busy || !f.name.trim() || !f.subject.trim() || !f.body.trim()}>
          {initial ? t("common.save") : t("communication.settings.addTemplate")}
        </Button>
      </div>
    </form>
  );
}

export function TemplateRow({ base, template }: { base: string; template: TemplateLite }) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  return (
    <li className="grid gap-2 px-4 py-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium">{template.name}</span>
        <span className="min-w-0 flex-1 truncate text-muted-foreground">{template.subject}</span>
        <Button type="button" size="sm" variant="ghost" onClick={() => setEditing((e) => !e)}>
          {editing ? t("common.cancel") : t("communication.edit")}
        </Button>
        <ActionButton path={`${base}/comms/email/templates/${template.id}`} method="DELETE" variant="ghost" confirm={t("communication.confirmDelete")}>
          {t("communication.delete")}
        </ActionButton>
      </div>
      {editing ? <TemplateForm base={base} initial={template} onDone={() => setEditing(false)} /> : null}
    </li>
  );
}
