"use client";

import { useState, type FormEvent } from "react";
import { Ban, Pause, Pencil, Play, Plus, RefreshCw, Trash2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select, Textarea } from "@/components/ui/input";
import { FormError } from "@/components/form-error";
import { useT } from "@/i18n/client";
import { api } from "@/lib/api-client";
import { useAction } from "../kit";
import { AutopilotWizard, type AutopilotForm } from "./wizard";

/** Client controls of /crm/prospecting: autopilot on/off/run/edit/archive, the new-autopilot panel, the do-not-contact list. */

export function NewAutopilot({ base, locale, hasContactProvider, startOpen }: { base: string; locale: string; hasContactProvider: boolean; startOpen: boolean }) {
  const t = useT();
  const [open, setOpen] = useState(startOpen);
  if (!open) {
    return (
      <Button variant="luminous" onClick={() => setOpen(true)}>
        <Plus aria-hidden />
        {t("crm.prospecting.new")}
      </Button>
    );
  }
  return (
    <section className="grid gap-3 rounded-xl border bg-[linear-gradient(135deg,color-mix(in_oklch,var(--primary)_8%,var(--surface)),var(--surface)_65%)] p-4 shadow-elev-1 sm:p-5" aria-labelledby="ap-new-h">
      <div className="flex items-start justify-between gap-2">
        <div className="grid gap-0.5">
          <h2 id="ap-new-h" className="font-display text-xl">
            {t("crm.prospecting.wizard.title")}
          </h2>
          <p className="text-sm text-muted-foreground">{t("crm.prospecting.wizard.subtitle")}</p>
        </div>
        {!startOpen ? (
          <Button variant="ghost" size="icon" onClick={() => setOpen(false)} aria-label={t("crm.rev.cancel")}>
            <X aria-hidden />
          </Button>
        ) : null}
      </div>
      <AutopilotWizard base={base} locale={locale} hasContactProvider={hasContactProvider} onDone={() => setOpen(false)} />
    </section>
  );
}

export function EditAutopilot({ base, locale, id, initial, hasContactProvider }: { base: string; locale: string; id: string; initial: Partial<AutopilotForm>; hasContactProvider: boolean }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return open ? (
    <div className="grid gap-3 rounded-xl border p-4">
      <div className="flex items-center justify-between">
        <h3 className="font-display text-lg">{t("crm.prospecting.edit")}</h3>
        <Button variant="ghost" size="icon" onClick={() => setOpen(false)} aria-label={t("crm.rev.cancel")}>
          <X aria-hidden />
        </Button>
      </div>
      <AutopilotWizard base={base} locale={locale} autopilotId={id} initial={initial} hasContactProvider={hasContactProvider} onDone={() => setOpen(false)} />
    </div>
  ) : (
    <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
      <Pencil aria-hidden />
      {t("crm.prospecting.edit")}
    </Button>
  );
}

/** Turn on (auto-send asks for an explicit confirmation), pause, run now, archive. */
export function AutopilotControls({ base, id, status, autonomy, dailySendCap }: { base: string; id: string; status: string; autonomy: string; dailySendCap: number }) {
  const t = useT();
  const { busy, error, run } = useAction();
  const [confirming, setConfirming] = useState(false);
  const [ran, setRan] = useState<string | null>(null);
  const setStatus = (s: "ACTIVE" | "PAUSED" | "ARCHIVED", confirmAutoSend?: boolean) => run(() => api(`${base}/crm/prospecting/${id}/status`, { body: { status: s, confirmAutoSend } }), () => setConfirming(false));
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {status !== "ACTIVE" ? (
          autonomy === "AUTO_SEND" && !confirming ? (
            <Button size="sm" onClick={() => setConfirming(true)} disabled={busy}>
              <Play aria-hidden />
              {t("crm.prospecting.turnOn")}
            </Button>
          ) : !confirming ? (
            <Button size="sm" onClick={() => void setStatus("ACTIVE")} disabled={busy} aria-busy={busy}>
              <Play aria-hidden />
              {t("crm.prospecting.turnOn")}
            </Button>
          ) : null
        ) : (
          <>
            <Button size="sm" variant="secondary" onClick={() => void setStatus("PAUSED")} disabled={busy}>
              <Pause aria-hidden />
              {t("crm.prospecting.pause")}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={busy}
              aria-busy={busy}
              onClick={() => void run(() => api<{ queued: boolean; run: { found: number; drafted: number; sent: number } | null }>(`${base}/crm/prospecting/${id}/run`, { body: {} }), (r) => setRan(r.queued ? t("crm.prospecting.runQueued") : r.run ? t("crm.prospecting.runDone", { found: r.run.found, drafted: r.run.drafted, sent: r.run.sent }) : t("crm.prospecting.runSkipped")))}
            >
              <RefreshCw aria-hidden />
              {t("crm.prospecting.runNow")}
            </Button>
          </>
        )}
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={() => {
            if (window.confirm(t("crm.prospecting.archiveConfirm"))) void setStatus("ARCHIVED");
          }}
        >
          <Trash2 aria-hidden />
          {t("crm.prospecting.archive")}
        </Button>
      </div>
      {confirming ? (
        <div className="grid gap-2 rounded-lg border border-warning/40 bg-warning/5 p-3 text-sm" role="group" aria-label={t("crm.prospecting.confirmTitle")}>
          <p className="font-medium">{t("crm.prospecting.confirmTitle")}</p>
          <p className="text-xs text-muted-foreground">{t("crm.prospecting.confirmBody", { cap: dailySendCap })}</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => void setStatus("ACTIVE", true)} disabled={busy} aria-busy={busy}>
              {t("crm.prospecting.confirmYes", { cap: dailySendCap })}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
              {t("crm.rev.cancel")}
            </Button>
          </div>
        </div>
      ) : null}
      {ran ? <p className="text-xs text-muted-foreground" role="status">{ran}</p> : null}
      <FormError error={error} />
    </div>
  );
}

const REASONS = ["do_not_contact", "unsubscribed", "bounced", "complaint", "customer", "competitor", "manual"] as const;

export interface SuppressionView {
  id: string;
  kind: "EMAIL" | "DOMAIN";
  value: string;
  reason: string;
  source: string;
  when: string;
}

/** The company's do-not-contact list: add one address/domain or paste many; remove entries. */
export function SuppressionManager({ base, rows, total, marketingUnsubscribes, canManage }: { base: string; rows: SuppressionView[]; total: number; marketingUnsubscribes: number; canManage: boolean }) {
  const t = useT();
  const { busy, error, run } = useAction();
  const [value, setValue] = useState("");
  const [reason, setReason] = useState<(typeof REASONS)[number]>("do_not_contact");
  const [bulk, setBulk] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const values = value.split(/[\n,;\s]+/).map((v) => v.trim()).filter(Boolean);
    if (!values.length) return;
    void run(
      () => (bulk || values.length > 1 ? api<{ added: number; invalid: number; duplicates: number }>(`${base}/crm/suppressions`, { body: { values, reason } }) : api(`${base}/crm/suppressions`, { body: { value: values[0], reason } })),
      (r) => {
        setValue("");
        const b = r as { added?: number; invalid?: number; duplicates?: number };
        setResult(typeof b.added === "number" ? t("crm.prospecting.dnc.bulkResult", { added: b.added, invalid: b.invalid ?? 0, duplicates: b.duplicates ?? 0 }) : t("crm.prospecting.dnc.added"));
      },
    );
  };
  const shown = q ? rows.filter((r) => r.value.includes(q.toLowerCase())) : rows;
  return (
    <section className="grid content-start gap-3 rounded-xl border bg-surface p-4 shadow-elev-1" aria-labelledby="dnc-h">
      <header className="grid gap-0.5">
        <h2 id="dnc-h" className="flex items-center gap-2 font-display text-lg">
          <Ban className="size-4 text-primary" aria-hidden />
          {t("crm.prospecting.dnc.title")}
        </h2>
        <p className="text-xs text-muted-foreground">{t("crm.prospecting.dnc.help", { total, marketing: marketingUnsubscribes })}</p>
      </header>
      {canManage ? (
        <form onSubmit={submit} className="grid gap-2" aria-busy={busy}>
          <Field label={bulk ? t("crm.prospecting.dnc.pasteLabel") : t("crm.prospecting.dnc.valueLabel")} htmlFor="dnc-v">
            {bulk ? (
              <Textarea id="dnc-v" rows={4} value={value} onChange={(e) => setValue(e.target.value)} maxLength={60_000} placeholder={"jane@acme.com\ncompetitor.com"} />
            ) : (
              <Input id="dnc-v" value={value} onChange={(e) => setValue(e.target.value)} maxLength={254} placeholder="jane@acme.com · acme.com" dir="ltr" />
            )}
          </Field>
          <div className="flex flex-wrap items-end gap-2">
            <Field label={t("crm.prospecting.dnc.reason")} htmlFor="dnc-r">
              <Select id="dnc-r" value={reason} onChange={(e) => setReason(e.target.value as (typeof REASONS)[number])}>
                {REASONS.map((r) => (
                  <option key={r} value={r}>
                    {t(`crm.prospecting.dnc.reasons.${r}`)}
                  </option>
                ))}
              </Select>
            </Field>
            <Button type="submit" size="sm" disabled={busy || !value.trim()} aria-busy={busy}>
              <Plus aria-hidden />
              {t("crm.prospecting.dnc.add")}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setBulk(!bulk)}>
              {bulk ? t("crm.prospecting.dnc.single") : t("crm.prospecting.dnc.paste")}
            </Button>
          </div>
          {result ? <p className="text-xs text-muted-foreground" role="status">{result}</p> : null}
          <FormError error={error} />
        </form>
      ) : null}
      {rows.length > 8 ? <Input aria-label={t("crm.prospecting.dnc.search")} placeholder={t("crm.prospecting.dnc.search")} value={q} onChange={(e) => setQ(e.target.value)} /> : null}
      {shown.length ? (
        <ul className="grid max-h-96 gap-1 overflow-y-auto text-sm">
          {shown.map((r) => (
            <li key={r.id} className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted/50">
              <span className="min-w-0 flex-1 truncate font-mono text-xs" dir="ltr">
                {r.kind === "DOMAIN" ? `@${r.value}` : r.value}
              </span>
              <Badge tone={r.reason === "bounced" || r.reason === "complaint" ? "danger" : "neutral"}>{t(`crm.prospecting.dnc.reasons.${r.reason}`)}</Badge>
              <span className="hidden text-xs text-muted-foreground sm:inline">{r.when}</span>
              {canManage ? (
                <Button size="icon" variant="ghost" aria-label={t("crm.prospecting.dnc.remove", { value: r.value })} disabled={busy} onClick={() => void run(() => api(`${base}/crm/suppressions/${r.id}`, { method: "DELETE" }))}>
                  <X aria-hidden />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">{t("crm.prospecting.dnc.empty")}</p>
      )}
    </section>
  );
}
