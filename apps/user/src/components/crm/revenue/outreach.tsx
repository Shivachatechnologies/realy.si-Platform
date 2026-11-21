"use client";

import { useState } from "react";
import Link from "next/link";
import { Ban, Check, Pencil, Send, Sparkles, Undo2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select, Textarea } from "@/components/ui/input";
import { FormError } from "@/components/form-error";
import { useT } from "@/i18n/client";
import { api } from "@/lib/api-client";
import { useAction } from "../kit";

export type RecipientRef = { leadId?: string; contactId?: string; dealId?: string };
export interface RecipientOption {
  value: string;
  label: string;
  group: "lead" | "contact";
}

const GOALS = ["first_touch", "follow_up", "book_meeting", "proposal_follow_up", "re_engage", "thank_you"] as const;

const refFrom = (v: string): RecipientRef => (v.startsWith("lead:") ? { leadId: v.slice(5) } : v.startsWith("contact:") ? { contactId: v.slice(8) } : v.startsWith("deal:") ? { dealId: v.slice(5) } : {});

/**
 * Write an email or let AI draft one. Either way it is saved as a draft (or sent for approval); sending happens only
 * from the approval card, through the connected provider.
 */
export function OutreachComposer({ base, locale, fixed, options, aiText, canSend, defaultGoal = "follow_up" }: { base: string; locale: string; fixed?: RecipientRef; options?: RecipientOption[]; aiText: boolean; canSend: boolean; defaultGoal?: (typeof GOALS)[number] }) {
  const t = useT();
  const ai = useAction();
  const save = useAction();
  const [target, setTarget] = useState(options?.[0]?.value ?? "");
  const [goal, setGoal] = useState<string>(defaultGoal);
  const [tone, setTone] = useState("friendly");
  const [guidance, setGuidance] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [saved, setSaved] = useState<string | null>(null);
  const ref = fixed ?? refFrom(target);
  const ready = Object.keys(ref).length === 1;
  return (
    <div className="grid gap-4">
      {!fixed && options ? (
        <Field label={t("crm.rev.outreach.to")} htmlFor="o-to">
          <Select id="o-to" value={target} onChange={(e) => setTarget(e.target.value)}>
            {!options.length ? <option value="">{t("crm.rev.outreach.noRecipients")}</option> : null}
            {(["lead", "contact"] as const).map((g) =>
              options.some((o) => o.group === g) ? (
                <optgroup key={g} label={t(`crm.rev.outreach.groups.${g}`)}>
                  {options
                    .filter((o) => o.group === g)
                    .map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                </optgroup>
              ) : null,
            )}
          </Select>
        </Field>
      ) : null}
      <section className="grid gap-3 rounded-lg border border-dashed bg-[linear-gradient(135deg,color-mix(in_oklch,var(--primary)_6%,transparent),transparent)] p-3">
        <p className="flex items-center gap-2 text-sm font-medium">
          <Sparkles className="size-4 text-primary" aria-hidden />
          {t("crm.rev.outreach.aiTitle")}
        </p>
        {aiText ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t("crm.rev.outreach.goal")} htmlFor="o-goal">
                <Select id="o-goal" value={goal} onChange={(e) => setGoal(e.target.value)}>
                  {GOALS.map((g) => (
                    <option key={g} value={g}>
                      {t(`crm.rev.outreach.goals.${g}`)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t("crm.rev.outreach.tone")} htmlFor="o-tone">
                <Select id="o-tone" value={tone} onChange={(e) => setTone(e.target.value)}>
                  {(["friendly", "formal", "short"] as const).map((x) => (
                    <option key={x} value={x}>
                      {t(`crm.rev.outreach.tones.${x}`)}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <Field label={t("crm.rev.outreach.guidance")} htmlFor="o-guidance">
              <Input id="o-guidance" value={guidance} maxLength={1000} onChange={(e) => setGuidance(e.target.value)} placeholder={t("crm.rev.outreach.guidancePlaceholder")} />
            </Field>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="luminous"
                disabled={!ready || ai.busy}
                aria-busy={ai.busy}
                onClick={() => void ai.run(() => api<{ id: string }>(`${base}/crm/outreach/ai`, { body: { ...ref, goal, tone, guidance: guidance || undefined } }), (m) => setSaved(m.id))}
              >
                <Sparkles aria-hidden />
                {ai.busy ? t("crm.rev.outreach.drafting") : t("crm.rev.outreach.draftWithAi")}
              </Button>
              <span className="text-xs text-muted-foreground">{t("crm.rev.outreach.aiNote")}</span>
            </div>
            <FormError error={ai.error} />
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            {t("crm.rev.outreach.aiMissing")}{" "}
            <Link href={`/${locale}/integrations`} className="text-primary underline">
              {t("crm.rev.connect")}
            </Link>
          </p>
        )}
      </section>
      <details className="grid gap-3">
        <summary className="cursor-pointer text-sm font-medium">{t("crm.rev.outreach.writeYourself")}</summary>
        <div className="mt-3 grid gap-3">
          <Field label={t("crm.rev.outreach.subject")} htmlFor="o-subject">
            <Input id="o-subject" value={subject} maxLength={200} onChange={(e) => setSubject(e.target.value)} />
          </Field>
          <Field label={t("crm.rev.outreach.body")} htmlFor="o-body">
            <Textarea id="o-body" value={body} rows={7} maxLength={10_000} onChange={(e) => setBody(e.target.value)} />
          </Field>
          <div className="flex flex-wrap gap-2">
            {(canSend ? [true, false] : [false]).map((submit) => (
              <Button
                key={String(submit)}
                type="button"
                variant={submit ? "default" : "secondary"}
                disabled={!ready || !subject.trim() || !body.trim() || save.busy}
                onClick={() =>
                  void save.run(
                    () => api<{ id: string }>(`${base}/crm/outreach`, { body: { ...ref, subject, body, submit } }),
                    (m) => {
                      setSaved(m.id);
                      setSubject("");
                      setBody("");
                    },
                  )
                }
              >
                {submit ? <Send aria-hidden /> : null}
                {t(submit ? "crm.rev.outreach.saveForApproval" : "crm.rev.outreach.saveDraft")}
              </Button>
            ))}
          </div>
          <FormError error={save.error} />
        </div>
      </details>
      {saved ? (
        <p role="status" className="text-sm text-success">
          {t("crm.rev.outreach.savedNote")}
        </p>
      ) : null}
    </div>
  );
}

export interface OutreachView {
  id: string;
  toEmail: string;
  toName: string | null;
  subject: string;
  body: string;
  status: "DRAFT" | "PENDING_APPROVAL" | "SENT" | "FAILED" | "CANCELLED";
  channel: string | null;
  error: string | null;
  aiProvider: string | null;
  sequence: { id: string; name: string } | null;
  step: number | null;
  when: string;
  recordHref: string | null;
}

const STATUS_TONE = { DRAFT: "neutral", PENDING_APPROVAL: "warning", SENT: "success", FAILED: "danger", CANCELLED: "neutral" } as const;

/** An email card: read, edit, approve & send, send for approval, cancel. Shows exactly what will be sent. */
export function OutreachCard({ base, locale, m, canManage, canSend }: { base: string; locale: string; m: OutreachView; canManage: boolean; canSend: boolean }) {
  const t = useT();
  const { busy, error, run } = useAction();
  const [editing, setEditing] = useState(false);
  const [subject, setSubject] = useState(m.subject);
  const [body, setBody] = useState(m.body);
  const open = m.status === "DRAFT" || m.status === "PENDING_APPROVAL" || m.status === "FAILED";
  return (
    <article className="grid gap-3 rounded-xl border bg-surface p-4 shadow-elev-1">
      <header className="flex flex-wrap items-center gap-2">
        <Badge tone={STATUS_TONE[m.status]}>{t(`crm.rev.outreach.status.${m.status}`)}</Badge>
        {m.aiProvider ? (
          <Badge tone="info" title={m.aiProvider}>
            <Sparkles className="size-3" aria-hidden /> {t("crm.rev.outreach.aiDrafted")}
          </Badge>
        ) : null}
        {m.sequence ? (
          <Link href={`/${locale}/crm/sequences/${m.sequence.id}`} className="text-xs text-muted-foreground hover:underline">
            {t("crm.rev.outreach.fromSequence", { name: m.sequence.name, step: (m.step ?? 0) + 1 })}
          </Link>
        ) : null}
        <span className="ms-auto text-xs text-muted-foreground">{m.when}</span>
      </header>
      <p className="text-sm">
        <span className="text-muted-foreground">{t("crm.rev.outreach.to")}: </span>
        {m.recordHref ? (
          <Link href={`/${locale}${m.recordHref}`} className="font-medium hover:underline">
            {m.toName ?? m.toEmail}
          </Link>
        ) : (
          <span className="font-medium">{m.toName ?? m.toEmail}</span>
        )}{" "}
        <span className="text-muted-foreground">&lt;{m.toEmail}&gt;</span>
      </p>
      {editing ? (
        <div className="grid gap-2">
          <Input aria-label={t("crm.rev.outreach.subject")} value={subject} maxLength={200} onChange={(e) => setSubject(e.target.value)} />
          <Textarea aria-label={t("crm.rev.outreach.body")} value={body} rows={8} maxLength={10_000} onChange={(e) => setBody(e.target.value)} />
          <div className="flex gap-2">
            <Button type="button" size="sm" disabled={busy} onClick={() => void run(() => api(`${base}/crm/outreach/${m.id}`, { method: "PATCH", body: { subject, body } }), () => setEditing(false))}>
              <Check aria-hidden />
              {t("crm.rev.save")}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
              <Undo2 aria-hidden />
              {t("crm.rev.cancel")}
            </Button>
          </div>
        </div>
      ) : (
        <div className="grid gap-1 rounded-lg bg-muted/40 p-3">
          <p className="font-medium">{m.subject}</p>
          <p className="whitespace-pre-wrap text-sm">{m.body}</p>
        </div>
      )}
      {m.status === "FAILED" && m.error ? <p className="text-sm text-danger">{m.error}</p> : null}
      {m.status === "SENT" && m.channel ? <p className="text-xs text-muted-foreground">{t("crm.rev.outreach.sentVia", { channel: t(`crm.rev.channels.${m.channel.replace(":", "_")}`) })}</p> : null}
      {open && canManage && !editing ? (
        <div className="flex flex-wrap gap-2">
          {canSend ? (
            <Button
              type="button"
              size="sm"
              disabled={busy}
              aria-busy={busy}
              onClick={() => {
                if (!window.confirm(t("crm.rev.outreach.confirmSend", { email: m.toEmail }))) return;
                void run(() => api(`${base}/crm/outreach/${m.id}/send`, { body: {} }));
              }}
            >
              <Send aria-hidden />
              {t("crm.rev.outreach.approveSend")}
            </Button>
          ) : null}
          {m.status !== "PENDING_APPROVAL" ? (
            <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => void run(() => api(`${base}/crm/outreach/${m.id}/submit`, { body: {} }))}>
              {t("crm.rev.outreach.askApproval")}
            </Button>
          ) : null}
          <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(true)}>
            <Pencil aria-hidden />
            {t("crm.rev.edit")}
          </Button>
          <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => void run(() => api(`${base}/crm/outreach/${m.id}`, { method: "DELETE" }))}>
            <Ban aria-hidden />
            {m.sequence ? t("crm.rev.outreach.skipStep") : t("crm.rev.outreach.discard")}
          </Button>
        </div>
      ) : null}
      <FormError error={error} />
    </article>
  );
}
