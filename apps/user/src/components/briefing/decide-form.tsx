"use client";

import { useState } from "react";
import { Check, X } from "lucide-react";
import { FormError } from "@/components/form-error";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Textarea } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { useT } from "@/i18n/client";
import { api } from "@/lib/api-client";

/**
 * Confirm a decision opened from a briefing link. Opening the link never decides anything (mail scanners prefetch
 * links); the person confirms here, signed in, and the single-use token is spent.
 */
export function DecideForm({ apiBase, token, initial }: { apiBase: string; token: string; initial: "approve" | "reject" | null }) {
  const t = useT();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState<string | null>(null);
  const decide = async (decision: "approve" | "reject") => {
    setBusy(decision);
    setError(null);
    try {
      const r = await api<{ status: string }>(`${apiBase}/briefing/decide`, { body: { token, decision, note: note || undefined } });
      setDone(r.status);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  };
  if (done) return <Notice tone={done === "REJECTED" ? "info" : "success"} title={t(`briefing.decide.done.${done === "REJECTED" ? "rejected" : "approved"}`)}>{t("briefing.decide.doneHint")}</Notice>;
  return (
    <div className="grid gap-4">
      <Field label={t("briefing.decide.note")} htmlFor="decide-note" hint={t("briefing.decide.noteHint")}>
        <Textarea id="decide-note" rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => decide("approve")} loading={busy === "approve"} disabled={!!busy} variant={initial === "reject" ? "secondary" : "default"}>
          <Check aria-hidden />
          {t("briefing.approve")}
        </Button>
        <Button onClick={() => decide("reject")} loading={busy === "reject"} disabled={!!busy} variant={initial === "reject" ? "default" : "secondary"}>
          <X aria-hidden />
          {t("briefing.reject")}
        </Button>
      </div>
      <FormError error={error} />
    </div>
  );
}
