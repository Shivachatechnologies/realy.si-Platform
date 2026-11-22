"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Paperclip, Plus, Send, StickyNote } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { FormError } from "@/components/form-error";
import { useT } from "@/i18n/client";
import { api, ApiError } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { useAction, type Person } from "@/components/comms/client";
import { CHANNELS, PRIORITIES, STATUSES } from "./constants";

const MAX_BYTES = 5 * 1024 * 1024;

interface Option {
  id: string;
  name: string;
}

interface Requesters {
  contacts: { id: string; name: string; email: string | null; accountId: string | null }[];
  accounts: Option[];
}

function useRequesterSearch(base: string, q: string) {
  const [r, setR] = useState<Requesters>({ contacts: [], accounts: [] });
  useEffect(() => {
    const h = setTimeout(() => {
      void api<Requesters>(`${base}/support/requesters?q=${encodeURIComponent(q)}`)
        .then(setR)
        .catch(() => undefined);
    }, 250);
    return () => clearTimeout(h);
  }, [base, q]);
  return r;
}

export function NewTicketForm({ base, locale, agents, categories, teams }: { base: string; locale: string; agents: Person[]; categories: Option[]; teams: Option[] }) {
  const t = useT();
  const router = useRouter();
  const empty = { subject: "", description: "", requesterId: "", requesterEmail: "", requesterName: "", accountId: "", channel: "PHONE", priority: "", categoryId: "", assigneeId: "", teamId: "", tags: "" };
  const [f, setF] = useState(empty);
  const [q, setQ] = useState("");
  const found = useRequesterSearch(base, q);
  const { busy, error, run } = useAction();
  const set = (k: keyof typeof empty) => (e: { target: { value: string } }) => setF((p) => ({ ...p, [k]: e.target.value }));
  return (
    <form
      className="grid gap-3 p-4 sm:grid-cols-3"
      onSubmit={(e) => {
        e.preventDefault();
        const tags = f.tags
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean);
        void run(() => api<{ id: string }>(`${base}/support/tickets`, { body: { ...f, tags } }), (r) => router.push(`/${locale}/support/tickets/${r.id}`));
      }}
    >
      <Field label={t("support.ticket.subject")} htmlFor="tk-subject" className="sm:col-span-3">
        <Input id="tk-subject" required maxLength={300} value={f.subject} onChange={set("subject")} />
      </Field>
      <Field label={t("support.ticket.description")} htmlFor="tk-desc" className="sm:col-span-3">
        <Textarea id="tk-desc" rows={4} maxLength={20000} value={f.description} onChange={set("description")} />
      </Field>
      <div className="grid gap-1.5 sm:col-span-3">
        <span className="text-sm font-medium">{t("support.ticket.requester")}</span>
        <div className="grid gap-2 sm:grid-cols-3">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("support.ticket.searchRequester")} aria-label={t("support.ticket.searchRequester")} />
          <Select
            value={f.requesterId}
            aria-label={t("support.ticket.existingContact")}
            onChange={(e) => {
              const c = found.contacts.find((x) => x.id === e.target.value);
              setF((p) => ({ ...p, requesterId: e.target.value, accountId: c?.accountId ?? p.accountId }));
            }}
          >
            <option value="">{t("support.ticket.newRequester")}</option>
            {found.contacts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} {c.email ? `<${c.email}>` : ""}
              </option>
            ))}
          </Select>
          <Select value={f.accountId} onChange={set("accountId")} aria-label={t("support.ticket.account")}>
            <option value="">{t("support.ticket.noAccount")}</option>
            {found.accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
        </div>
        {!f.requesterId ? (
          <div className="grid gap-2 sm:grid-cols-2">
            <Input type="email" value={f.requesterEmail} onChange={set("requesterEmail")} placeholder={t("support.ticket.requesterEmail")} aria-label={t("support.ticket.requesterEmail")} />
            <Input value={f.requesterName} maxLength={200} onChange={set("requesterName")} placeholder={t("support.ticket.requesterName")} aria-label={t("support.ticket.requesterName")} />
          </div>
        ) : null}
      </div>
      <Field label={t("support.ticket.channel")} htmlFor="tk-channel">
        <Select id="tk-channel" value={f.channel} onChange={set("channel")}>
          {CHANNELS.map((c) => (
            <option key={c} value={c}>
              {t(`support.channels.${c}`)}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("support.ticket.priority")} htmlFor="tk-priority" hint={t("support.ticket.autoHint")}>
        <Select id="tk-priority" value={f.priority} onChange={set("priority")}>
          <option value="">{t("support.ticket.auto")}</option>
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {t(`support.priorities.${p}`)}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("support.ticket.category")} htmlFor="tk-category" hint={t("support.ticket.autoHint")}>
        <Select id="tk-category" value={f.categoryId} onChange={set("categoryId")}>
          <option value="">{t("support.ticket.auto")}</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("support.ticket.assignee")} htmlFor="tk-assignee" hint={t("support.ticket.rulesHint")}>
        <Select id="tk-assignee" value={f.assigneeId} onChange={set("assigneeId")}>
          <option value="">{t("support.ticket.byRules")}</option>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("support.ticket.team")} htmlFor="tk-team">
        <Select id="tk-team" value={f.teamId} onChange={set("teamId")}>
          <option value="">{t("support.ticket.noTeam")}</option>
          {teams.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("support.ticket.tags")} htmlFor="tk-tags" hint={t("support.ticket.tagsHint")}>
        <Input id="tk-tags" value={f.tags} onChange={set("tags")} />
      </Field>
      <div className="grid gap-2 sm:col-span-3">
        <FormError error={error} />
        <div>
          <Button type="submit" disabled={busy || !f.subject.trim()}>
            <Plus aria-hidden />
            {t("support.ticket.create")}
          </Button>
        </div>
      </div>
    </form>
  );
}

/** Ticket properties panel: status, priority, assignee, category, team, tags. */
export function TicketProperties({ base, ticket, agents, categories, teams }: {
  base: string;
  ticket: { id: string; status: string; priority: string; assigneeId: string | null; categoryId: string | null; teamId: string | null; tags: string[] };
  agents: Person[];
  categories: Option[];
  teams: Option[];
}) {
  const t = useT();
  const [tags, setTags] = useState(ticket.tags.join(", "));
  const { busy, error, run } = useAction();
  const patch = (body: Record<string, unknown>) => run(() => api(`${base}/support/tickets/${ticket.id}`, { method: "PATCH", body }));
  const row = "grid grid-cols-[6.5rem_minmax(0,1fr)] items-center gap-2";
  return (
    <div className="grid gap-2 text-sm">
      <label className={row}>
        <span className="text-muted-foreground">{t("common.status")}</span>
        <Select value={ticket.status} disabled={busy} onChange={(e) => void patch({ status: e.target.value })}>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`support.statuses.${s}`)}
            </option>
          ))}
        </Select>
      </label>
      <label className={row}>
        <span className="text-muted-foreground">{t("support.ticket.priority")}</span>
        <Select value={ticket.priority} disabled={busy} onChange={(e) => void patch({ priority: e.target.value })}>
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {t(`support.priorities.${p}`)}
            </option>
          ))}
        </Select>
      </label>
      <label className={row}>
        <span className="text-muted-foreground">{t("support.ticket.assignee")}</span>
        <Select value={ticket.assigneeId ?? ""} disabled={busy} onChange={(e) => void patch({ assigneeId: e.target.value || null })}>
          <option value="">{t("support.ticket.unassigned")}</option>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </Select>
      </label>
      <label className={row}>
        <span className="text-muted-foreground">{t("support.ticket.category")}</span>
        <Select value={ticket.categoryId ?? ""} disabled={busy} onChange={(e) => void patch({ categoryId: e.target.value || null })}>
          <option value="">{t("support.ticket.noCategory")}</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </label>
      <label className={row}>
        <span className="text-muted-foreground">{t("support.ticket.team")}</span>
        <Select value={ticket.teamId ?? ""} disabled={busy} onChange={(e) => void patch({ teamId: e.target.value || null })}>
          <option value="">{t("support.ticket.noTeam")}</option>
          {teams.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </label>
      <form
        className={row}
        onSubmit={(e) => {
          e.preventDefault();
          void patch({ tags: tags.split(",").map((x) => x.trim()).filter(Boolean) });
        }}
      >
        <span className="text-muted-foreground">{t("support.ticket.tags")}</span>
        <Input value={tags} onChange={(e) => setTags(e.target.value)} onBlur={() => tags !== ticket.tags.join(", ") && void patch({ tags: tags.split(",").map((x) => x.trim()).filter(Boolean) })} aria-label={t("support.ticket.tags")} />
      </form>
      <FormError error={error} />
    </div>
  );
}

async function fileToBase64(file: File) {
  const buf = new Uint8Array(await file.arrayBuffer());
  let bin = "";
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** Public reply (emailed to the requester) or internal note, with attachments (≤ 5 MB each). */
export function ReplyBox({ base, ticketId, status, hasEmail, prefill }: { base: string; ticketId: string; status: string; hasEmail: boolean; prefill?: { id: string; body: string } | null }) {
  const t = useT();
  const router = useRouter();
  const [kind, setKind] = useState<"PUBLIC_REPLY" | "INTERNAL_NOTE">("PUBLIC_REPLY");
  const [body, setBody] = useState(prefill?.body ?? "");
  const [next, setNext] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [result, setResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const tooBig = files.find((f) => f.size > MAX_BYTES);
  const submit = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const r = await api<{ message: { id: string }; emailStatus: string | null }>(`${base}/support/tickets/${ticketId}/messages`, { body: { kind, body, status: next || undefined } });
      for (const f of files) {
        await api(`${base}/support/tickets/${ticketId}/attachments`, { body: { fileName: f.name, contentType: f.type || "application/octet-stream", dataBase64: await fileToBase64(f), messageId: r.message.id } });
      }
      if (prefill) await api(`${base}/support/tickets/${ticketId}/drafts/${prefill.id}`, { method: "DELETE" }).catch(() => undefined);
      setResult(kind === "PUBLIC_REPLY" ? r.emailStatus : "NOTE");
      setBody("");
      setFiles([]);
      setNext("");
      if (fileRef.current) fileRef.current.value = "";
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err : err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className="grid gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="flex gap-1" role="tablist">
        {(["PUBLIC_REPLY", "INTERNAL_NOTE"] as const).map((k) => (
          <button key={k} type="button" role="tab" aria-selected={kind === k} onClick={() => setKind(k)} className={cn("flex items-center gap-1 rounded-md px-3 py-1 text-sm", kind === k ? (k === "INTERNAL_NOTE" ? "bg-warning/15 font-medium" : "bg-accent font-medium") : "text-muted-foreground hover:bg-muted")}>
            {k === "PUBLIC_REPLY" ? <Send className="size-3.5" aria-hidden /> : <StickyNote className="size-3.5" aria-hidden />}
            {t(`support.reply.kinds.${k}`)}
          </button>
        ))}
      </div>
      {kind === "PUBLIC_REPLY" && !hasEmail ? <Notice tone="warning">{t("support.reply.noEmail")}</Notice> : null}
      <Textarea rows={6} maxLength={20000} value={body} onChange={(e) => setBody(e.target.value)} className={kind === "INTERNAL_NOTE" ? "bg-warning/5" : undefined} placeholder={kind === "PUBLIC_REPLY" ? t("support.reply.placeholder") : t("support.reply.notePlaceholder")} aria-label={t(`support.reply.kinds.${kind}`)} />
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex cursor-pointer items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-muted">
          <Paperclip className="size-3.5" aria-hidden />
          {t("support.reply.attach")}
          <input ref={fileRef} type="file" multiple className="sr-only" onChange={(e) => setFiles(Array.from(e.target.files ?? []).slice(0, 5))} />
        </label>
        {files.map((f) => (
          <span key={f.name} className={cn("rounded-md bg-muted px-2 py-0.5 text-xs", f.size > MAX_BYTES && "text-danger")}>
            {f.name} · {Math.max(1, Math.round(f.size / 1024))} KB
          </span>
        ))}
        <Select value={next} onChange={(e) => setNext(e.target.value)} className="ms-auto h-8 w-auto text-xs" aria-label={t("support.reply.setStatus")}>
          <option value="">{kind === "PUBLIC_REPLY" && (status === "NEW" || status === "OPEN") ? t("support.reply.statusDefault") : t("support.reply.keepStatus")}</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {t("support.reply.setTo", { status: t(`support.statuses.${s}`) })}
            </option>
          ))}
        </Select>
      </div>
      {tooBig ? <Notice tone="danger">{t("support.reply.tooBig", { name: tooBig.name })}</Notice> : null}
      <FormError error={error} />
      {result ? <Notice tone={result === "SENT" || result === "NOTE" ? "success" : "warning"}>{t(`support.reply.result.${result}`)}</Notice> : null}
      <div>
        <Button type="submit" disabled={busy || !body.trim() || !!tooBig}>
          {kind === "PUBLIC_REPLY" ? t("support.reply.send") : t("support.reply.addNote")}
        </Button>
      </div>
    </form>
  );
}

export function FollowUpForm({ base, ticketId, agents }: { base: string; ticketId: string; agents: Person[] }) {
  const t = useT();
  const [f, setF] = useState({ title: "", assigneeId: "", dueDate: "" });
  const { busy, error, run } = useAction();
  return (
    <form
      className="grid gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        void run(() => api(`${base}/support/tickets/${ticketId}/follow-ups`, { body: { title: f.title, assigneeId: f.assigneeId || null, dueDate: f.dueDate } }), () => setF({ title: "", assigneeId: "", dueDate: "" }));
      }}
    >
      <Input required maxLength={300} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder={t("support.followUps.title")} aria-label={t("support.followUps.title")} />
      <div className="grid grid-cols-2 gap-2">
        <Select value={f.assigneeId} onChange={(e) => setF({ ...f, assigneeId: e.target.value })} aria-label={t("support.ticket.assignee")}>
          <option value="">{t("support.ticket.unassigned")}</option>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </Select>
        <Input type="date" value={f.dueDate} onChange={(e) => setF({ ...f, dueDate: e.target.value })} aria-label={t("support.followUps.due")} />
      </div>
      <FormError error={error} />
      <div>
        <Button type="submit" size="sm" variant="secondary" disabled={busy || !f.title.trim()}>
          <Plus aria-hidden />
          {t("support.followUps.add")}
        </Button>
      </div>
    </form>
  );
}

export function FollowUpToggle({ base, ticketId, taskId, done }: { base: string; ticketId: string; taskId: string; done: boolean }) {
  const t = useT();
  const { busy, run } = useAction();
  return <input type="checkbox" checked={done} disabled={busy} aria-label={t("support.followUps.done")} onChange={(e) => void run(() => api(`${base}/support/tickets/${ticketId}/follow-ups/${taskId}`, { method: "PATCH", body: { done: e.target.checked } }))} />;
}
