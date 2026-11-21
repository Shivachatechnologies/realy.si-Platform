"use client";

import { useState } from "react";
import { Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { FormError } from "@/components/form-error";
import { useAction } from "@/components/comms/client";
import { useT } from "@/i18n/client";
import { api } from "@/lib/api-client";

export interface TelephonyValue {
  telephony: "PROVIDER" | "TWILIO";
  bridgeMode: "PROVIDER_SIP" | "CUSTOM_SIP" | "MEDIA_STREAM";
  bridgeSipUri: string | null;
  sipUsername: string | null;
  sipPasswordSet: boolean;
  mediaStreamUrl: string | null;
  twilioFromNumber: string | null;
  liveTranscription: boolean;
  humanTransferNumber: string | null;
  retryMaxAttempts: number;
  retryDelayMin: number;
  twilioVoiceUrl: string;
  twilioStatusUrl: string;
}

function CopyField({ label, value }: { label: string; value: string }) {
  const t = useT();
  const [ok, setOk] = useState(false);
  return (
    <div className="grid gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-md border bg-muted/40 px-2 py-1.5 text-xs" dir="ltr">{value}</code>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => {
            void navigator.clipboard?.writeText(value).then(() => setOk(true), () => setOk(false));
          }}
          aria-label={t("voice.telephony.copy")}
        >
          <Copy aria-hidden />
          {ok ? t("voice.telephony.copied") : t("voice.telephony.copy")}
        </Button>
      </div>
    </div>
  );
}

/** Telephony layer (provider numbers or Twilio + AI bridge), human transfer number and retry rules. */
export function TelephonyForm({ base, value, canManage, twilioConnected, retellSelected }: { base: string; value: TelephonyValue; canManage: boolean; twilioConnected: boolean; retellSelected: boolean }) {
  const t = useT();
  const [f, setF] = useState({ ...value, sipPassword: "" });
  const [saved, setSaved] = useState(false);
  const [connectNumber, setConnectNumber] = useState(value.twilioFromNumber ?? "");
  const [connected, setConnected] = useState<string | null>(null);
  const { busy, error, run } = useAction();
  const connect = useAction();
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => {
    setSaved(false);
    setF((p) => ({ ...p, [k]: v }));
  };
  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void run(
          () =>
            api(`${base}/voice/settings`, {
              method: "PATCH",
              body: {
                telephony: f.telephony,
                bridgeMode: f.bridgeMode,
                bridgeSipUri: f.bridgeSipUri || null,
                sipUsername: f.sipUsername || null,
                ...(f.sipPassword ? { sipPassword: f.sipPassword } : {}),
                mediaStreamUrl: f.mediaStreamUrl || null,
                twilioFromNumber: f.twilioFromNumber || null,
                liveTranscription: f.liveTranscription,
                humanTransferNumber: f.humanTransferNumber || null,
                retryMaxAttempts: f.retryMaxAttempts,
                retryDelayMin: f.retryDelayMin,
              },
            }),
          () => setSaved(true),
        );
      }}
    >
      <fieldset disabled={!canManage || busy} className="grid gap-4">
        <Field label={t("voice.telephony.layer")} htmlFor="tel-layer" hint={t("voice.telephony.layerHint")}>
          <Select id="tel-layer" value={f.telephony} onChange={(e) => set("telephony", e.target.value as TelephonyValue["telephony"])}>
            <option value="PROVIDER">{t("voice.telephony.layers.PROVIDER")}</option>
            <option value="TWILIO">{t("voice.telephony.layers.TWILIO")}</option>
          </Select>
        </Field>
        {f.telephony === "TWILIO" ? (
          <>
            {!twilioConnected ? <Notice tone="warning">{t("voice.telephony.twilioMissing")}</Notice> : null}
            <Field label={t("voice.telephony.bridge")} htmlFor="tel-bridge" hint={t(`voice.telephony.bridgeHints.${f.bridgeMode}`)}>
              <Select id="tel-bridge" value={f.bridgeMode} onChange={(e) => set("bridgeMode", e.target.value as TelephonyValue["bridgeMode"])}>
                {(["PROVIDER_SIP", "CUSTOM_SIP", "MEDIA_STREAM"] as const).map((m) => <option key={m} value={m}>{t(`voice.telephony.bridges.${m}`)}</option>)}
              </Select>
            </Field>
            {f.bridgeMode === "PROVIDER_SIP" && !retellSelected ? <Notice tone="info">{t("voice.telephony.providerSipRetell")}</Notice> : null}
            {f.bridgeMode !== "MEDIA_STREAM" ? (
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label={t("voice.telephony.sipUri")} htmlFor="tel-sip" className="sm:col-span-3">
                  <Input id="tel-sip" dir="ltr" value={f.bridgeSipUri ?? ""} onChange={(e) => set("bridgeSipUri", e.target.value)} placeholder="sip:assistant@sip.vapi.ai" />
                </Field>
                <Field label={t("voice.telephony.sipUser")} htmlFor="tel-sip-user">
                  <Input id="tel-sip-user" dir="ltr" autoComplete="off" value={f.sipUsername ?? ""} onChange={(e) => set("sipUsername", e.target.value)} />
                </Field>
                <Field label={t("voice.telephony.sipPassword")} htmlFor="tel-sip-pw" hint={f.sipPasswordSet ? t("voice.telephony.sipPasswordSet") : undefined}>
                  <Input id="tel-sip-pw" type="password" autoComplete="new-password" value={f.sipPassword} onChange={(e) => set("sipPassword", e.target.value)} />
                </Field>
              </div>
            ) : (
              <Field label={t("voice.telephony.streamUrl")} htmlFor="tel-wss" hint={t("voice.telephony.streamHint")}>
                <Input id="tel-wss" dir="ltr" value={f.mediaStreamUrl ?? ""} onChange={(e) => set("mediaStreamUrl", e.target.value)} placeholder="wss://bridge.example.com/twilio" />
              </Field>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t("voice.telephony.callerId")} htmlFor="tel-from">
                <Input id="tel-from" dir="ltr" inputMode="tel" value={f.twilioFromNumber ?? ""} onChange={(e) => set("twilioFromNumber", e.target.value)} placeholder="+15551234567" />
              </Field>
              <label className="flex items-start gap-2 self-end rounded-md border p-3 text-sm">
                <input type="checkbox" className="mt-0.5 size-4 accent-[var(--primary)]" checked={f.liveTranscription} onChange={(e) => set("liveTranscription", e.target.checked)} />
                <span className="grid gap-0.5">
                  <span className="font-medium">{t("voice.telephony.liveTranscription")}</span>
                  <span className="text-xs text-muted-foreground">{t("voice.telephony.liveTranscriptionHint")}</span>
                </span>
              </label>
            </div>
            <div className="grid gap-2 rounded-md border bg-muted/20 p-3">
              <p className="text-xs text-muted-foreground">{t("voice.telephony.webhooksHint")}</p>
              <CopyField label={t("voice.telephony.voiceUrl")} value={value.twilioVoiceUrl} />
              <CopyField label={t("voice.telephony.statusUrl")} value={value.twilioStatusUrl} />
            </div>
          </>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label={t("voice.telephony.humanNumber")} htmlFor="tel-human" hint={t("voice.telephony.humanHint")}>
            <Input id="tel-human" dir="ltr" inputMode="tel" value={f.humanTransferNumber ?? ""} onChange={(e) => set("humanTransferNumber", e.target.value)} placeholder="+44 20 7946 0958" />
          </Field>
          <Field label={t("voice.telephony.retries")} htmlFor="tel-retries">
            <Input id="tel-retries" type="number" min={0} max={5} value={f.retryMaxAttempts} onChange={(e) => set("retryMaxAttempts", Number(e.target.value))} />
          </Field>
          <Field label={t("voice.telephony.retryDelay")} htmlFor="tel-delay">
            <Input id="tel-delay" type="number" min={15} max={10080} value={f.retryDelayMin} onChange={(e) => set("retryDelayMin", Number(e.target.value))} />
          </Field>
        </div>
      </fieldset>
      <FormError error={error} />
      {saved ? <p className="text-sm text-success" role="status">{t("voice.telephony.saved")}</p> : null}
      {canManage ? (
        <div className="flex flex-wrap items-end gap-3">
          <Button type="submit" disabled={busy} aria-busy={busy}>{t("voice.telephony.save")}</Button>
          {f.telephony === "TWILIO" && twilioConnected ? (
            <span className="flex flex-wrap items-end gap-2">
              <Input aria-label={t("voice.telephony.connectNumber")} dir="ltr" value={connectNumber} onChange={(e) => setConnectNumber(e.target.value)} placeholder="+15551234567" className="w-44" />
              <Button type="button" variant="secondary" disabled={connect.busy || !connectNumber.trim()} onClick={() => void connect.run(() => api<{ number: string }>(`${base}/voice/twilio-number`, { method: "POST", body: { number: connectNumber.trim() } }), (r) => setConnected(r.number))}>
                {t("voice.telephony.connectNumber")}
              </Button>
            </span>
          ) : null}
        </div>
      ) : null}
      {connected ? <p className="text-sm text-success" role="status">{t("voice.telephony.numberConnected", { number: connected })}</p> : null}
      <FormError error={connect.error} />
    </form>
  );
}
