"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { OctagonPause, Play, Zap, ZapOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ReasonDialog } from "@/components/ui/reason-dialog";
import { FormError } from "@/components/form-error";
import { useT } from "@/i18n/client";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";

/** The company-wide Auto mode switch. While off, every "Auto" rule behaves as "Ask me". */
export function AutoModeSwitch({ path, enabled, canManage }: { path: string; enabled: boolean; canManage: boolean }) {
  const t = useT();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function toggle() {
    if (!enabled && !window.confirm(t("autonomy.autoMode.confirmOn"))) return;
    setBusy(true);
    setError(null);
    try {
      await api(path, { body: { autoModeEnabled: !enabled } });
      router.refresh();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-3">
      <div className="flex items-start gap-3">
        <span aria-hidden className={cn("grid size-10 shrink-0 place-items-center rounded-full border", enabled ? "border-success/40 bg-success/10 text-success" : "bg-muted text-muted-foreground")}>
          {enabled ? <Zap className="size-5" /> : <ZapOff className="size-5" />}
        </span>
        <div className="grid min-w-0 gap-0.5">
          <p className="font-medium">{enabled ? t("autonomy.autoMode.on") : t("autonomy.autoMode.off")}</p>
          <p className="text-sm text-muted-foreground">{enabled ? t("autonomy.autoMode.explainOn") : t("autonomy.autoMode.explainOff")}</p>
        </div>
      </div>
      {canManage ? (
        <div>
          <Button
            type="button"
            role="switch"
            aria-checked={enabled}
            variant={enabled ? "secondary" : "default"}
            size="sm"
            loading={busy}
            onClick={() => void toggle()}
          >
            {enabled ? t("autonomy.autoMode.turnOff") : t("autonomy.autoMode.turnOn")}
          </Button>
          {!enabled ? <p className="mt-1.5 text-xs text-muted-foreground">{t("autonomy.autoMode.mfa")}</p> : null}
        </div>
      ) : null}
      {error ? <FormError error={error} /> : null}
    </div>
  );
}

/** Emergency "Pause all AI" for this company (reason goes to the audit log), and resume. */
export function PauseAllControl({ path, paused, canManage }: { path: string; paused: boolean; canManage: boolean }) {
  const t = useT();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function send(body: { paused: boolean; reason?: string }) {
    await api(path, { body });
    router.refresh();
  }

  if (!canManage) return null;
  if (paused) {
    return (
      <div className="grid gap-1">
        <Button
          type="button"
          size="sm"
          loading={busy}
          onClick={async () => {
            if (!window.confirm(t("autonomy.pause.confirmResume"))) return;
            setBusy(true);
            setError(null);
            try {
              await send({ paused: false });
            } catch (err) {
              setError(err);
            } finally {
              setBusy(false);
            }
          }}
        >
          <Play aria-hidden />
          {t("autonomy.pause.resume")}
        </Button>
        {error ? <FormError error={error} /> : null}
      </div>
    );
  }
  return (
    <ReasonDialog
      title={t("autonomy.pause.dialogTitle")}
      description={t("autonomy.pause.dialogDescription")}
      confirmLabel={t("autonomy.pause.button")}
      onConfirm={(reason) => send({ paused: true, reason })}
      trigger={
        <Button type="button" variant="danger" className="w-full sm:w-auto">
          <OctagonPause aria-hidden />
          {t("autonomy.pause.button")}
        </Button>
      }
    />
  );
}
