"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Flag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Select, Textarea } from "@/components/ui/input";
import { FormError } from "@/components/form-error";
import { useT } from "@/i18n/client";
import { api } from "@/lib/api-client";

/** Flag a problem with an auto-approved action: a trust signal that can send the rule back to "Ask me". */
export function ReportProblem({ path }: { path: string }) {
  const t = useT();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<"COMPLAINT" | "REVERSAL" | "EDITED">("COMPLAINT");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(path, { body: { kind, note: note || undefined } });
      setOpen(false);
      setNote("");
      router.refresh();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (setOpen(o), setError(null))}>
      <DialogTrigger asChild>
        <Button type="button" size="sm" variant="ghost">
          <Flag aria-hidden />
          {t("autonomy.log.report")}
        </Button>
      </DialogTrigger>
      <DialogContent title={t("autonomy.log.reportTitle")} description={t("autonomy.log.reportDescription")} closeLabel={t("common.close")}>
        <form onSubmit={submit} className="grid gap-3">
          <Field label={t("autonomy.log.reportKind")} htmlFor="report-kind">
            <Select id="report-kind" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
              {(["COMPLAINT", "REVERSAL", "EDITED"] as const).map((k) => (
                <option key={k} value={k}>
                  {t(`autonomy.log.reportKinds.${k}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("autonomy.log.reportNote")} htmlFor="report-note">
            <Textarea id="report-note" maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <FormError error={error} />
          <div className="flex justify-end">
            <Button type="submit" loading={busy}>
              {t("autonomy.log.reportSend")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Keeps the live log fresh: refreshes the server data every 30 s while the tab is visible. */
export function LiveRefresh({ seconds = 30 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, seconds * 1000);
    return () => window.clearInterval(id);
  }, [router, seconds]);
  return null;
}
