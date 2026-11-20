"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, CheckCheck, Clock, MessageSquarePlus, X } from "lucide-react";
import { FormError } from "@/components/form-error";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { useI18n } from "@/i18n/client";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";

/** Approve (runs the action now, as you) or reject a request, with an optional note that lands in the audit log. */
export function DecisionActions({ base, needsMfa }: { base: string; needsMfa: boolean }) {
  const { t } = useI18n();
  const router = useRouter();
  const [note, setNote] = useState("");
  const [showNote, setShowNote] = useState(false);
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [error, setError] = useState<unknown>(null);
  async function decide(decision: "approve" | "reject") {
    setBusy(decision);
    setError(null);
    try {
      await api(`${base}/decision`, { body: { decision, note: note.trim() || undefined } });
      router.refresh();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  }
  return (
    <div className="grid gap-2">
      {showNote ? <Textarea rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("decisionInbox.notePlaceholder")} aria-label={t("decisionInbox.note")} /> : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" onClick={() => decide("approve")} disabled={!!busy} aria-busy={busy === "approve"}>
          <Check aria-hidden /> {busy === "approve" ? t("decisionInbox.running") : t("decisionInbox.approve")}
        </Button>
        <Button type="button" size="sm" variant="secondary" onClick={() => decide("reject")} disabled={!!busy} aria-busy={busy === "reject"}>
          <X aria-hidden /> {t("decisionInbox.reject")}
        </Button>
        {!showNote ? (
          <button type="button" onClick={() => setShowNote(true)} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <MessageSquarePlus className="size-3.5" aria-hidden /> {t("decisionInbox.addNote")}
          </button>
        ) : null}
      </div>
      {needsMfa ? <p className="text-[11px] text-muted-foreground">{t("decisionInbox.mfaHint")}</p> : null}
      <FormError error={error} />
    </div>
  );
}

/** Live "expires in …" countdown; turns amber in the last hour. */
export function ExpiryCountdown({ expiresAt }: { expiresAt: string }) {
  const { t, locale } = useI18n();
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    const h = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(h);
  }, []);
  const end = new Date(expiresAt).getTime();
  const left = end - now;
  if (left <= 0) return <span className="text-xs text-danger">{t("decisionInbox.expired")}</span>;
  const mins = Math.floor(left / 60_000);
  const parts = mins >= 1440 ? { d: Math.floor(mins / 1440), h: Math.floor((mins % 1440) / 60) } : { h: Math.floor(mins / 60), m: mins % 60 };
  const text = "d" in parts ? t("decisionInbox.leftDays", { d: parts.d ?? 0, h: parts.h }) : parts.h ? t("decisionInbox.leftHours", { h: parts.h, m: parts.m ?? 0 }) : t("decisionInbox.leftMinutes", { m: parts.m ?? 0 });
  return (
    <span suppressHydrationWarning title={new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(end)} className={cn("inline-flex items-center gap-1 text-xs tabular-nums", left < 3_600_000 ? "font-medium text-warning" : "text-muted-foreground")}>
      <Clock className="size-3.5" aria-hidden />
      {t("decisionInbox.expiresIn", { left: text })}
    </span>
  );
}

/** Approve every low-risk request in one go (each one still runs through the normal checks, one by one). */
export function BulkApprove({ apiBase, ids }: { apiBase: string; ids: string[] }) {
  const { t } = useI18n();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(0);
  const [failed, setFailed] = useState(0);
  if (!ids.length) return null;
  async function run() {
    if (!window.confirm(t("decisionInbox.bulk.confirm", { count: ids.length }))) return;
    setBusy(true);
    setDone(0);
    setFailed(0);
    for (const id of ids) {
      try {
        await api(`${apiBase}/approvals/${id}/decision`, { body: { decision: "approve", note: t("decisionInbox.bulk.note") } });
        setDone((n) => n + 1);
      } catch {
        setFailed((n) => n + 1);
      }
    }
    setBusy(false);
    router.refresh();
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" size="sm" variant="soft" onClick={run} disabled={busy} aria-busy={busy}>
        <CheckCheck aria-hidden /> {t("decisionInbox.bulk.label", { count: ids.length })}
      </Button>
      {busy || done || failed ? (
        <span className="text-xs text-muted-foreground" aria-live="polite">
          {t("decisionInbox.bulk.progress", { done, total: ids.length })}
          {failed ? ` · ${t("decisionInbox.bulk.failed", { count: failed })}` : ""}
        </span>
      ) : null}
    </div>
  );
}
