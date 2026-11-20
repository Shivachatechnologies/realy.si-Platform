"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Ban, Play, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { FormError } from "@/components/form-error";
import { useT } from "@/i18n/client";
import { api } from "@/lib/api-client";

function useCall() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const run = async (path: string, body: unknown = {}) => {
    setBusy(true);
    setError(null);
    try {
      await api(path, { body });
      router.refresh();
      return true;
    } catch (err) {
      setError(err);
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run };
}

/** While a run is active: ask the server to advance it and re-render with the real state (every 8 s). */
export function LiveRefresh({ base, active }: { base: string; active: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    let stopped = false;
    const tick = async () => {
      await api(`${base}/advance`, { body: {} }).catch(() => undefined);
      if (!stopped) router.refresh();
    };
    const id = setInterval(tick, 8000);
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, [active, base, router]);
  return null;
}

export function StartRunButton({ base }: { base: string }) {
  const t = useT();
  const c = useCall();
  return (
    <div className="grid gap-2">
      <div>
        <Button loading={c.busy} onClick={() => c.run(`${base}/start`)}>
          <Play aria-hidden />
          {t("builder.run.start")}
        </Button>
      </div>
      <FormError error={c.error} />
    </div>
  );
}

export function CancelRunButton({ base }: { base: string }) {
  const t = useT();
  const c = useCall();
  return (
    <>
      <Button variant="secondary" size="sm" loading={c.busy} onClick={() => window.confirm(t("builder.run.confirmCancel")) && c.run(`${base}/cancel`)}>
        <Ban aria-hidden />
        {t("builder.run.cancel")}
      </Button>
      {c.error ? <FormError error={c.error} /> : null}
    </>
  );
}

export function RetryStep({ base, stepId }: { base: string; stepId: string }) {
  const t = useT();
  const c = useCall();
  const [open, setOpen] = useState(false);
  const [feedback, setFeedback] = useState("");
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap gap-2">
        <Button size="sm" loading={c.busy} onClick={() => c.run(`${base}/steps/${stepId}/retry`, feedback.trim() ? { feedback: feedback.trim() } : {})}>
          <RotateCcw aria-hidden />
          {t("builder.run.retry")}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          {t("builder.run.addFeedback")}
        </Button>
      </div>
      {open ? <Textarea rows={2} value={feedback} onChange={(e) => setFeedback(e.target.value)} maxLength={2000} aria-label={t("builder.run.addFeedback")} placeholder={t("builder.decisions.feedbackPlaceholder")} /> : null}
      <FormError error={c.error} />
    </div>
  );
}
