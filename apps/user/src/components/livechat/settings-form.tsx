"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Eye, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { FormError } from "@/components/form-error";
import { useT } from "@/i18n/client";
import { api } from "@/lib/api-client";

export interface LivechatSettingsData {
  enabled: boolean;
  publicKey: string;
  allowedOrigins: string[];
  brandColor: string;
  position: string;
  assistantName: string;
  greeting: string | null;
  aiEnabled: boolean;
  brainTag: string;
  publicFacts: string | null;
  autoCreateLeads: boolean;
  autoCreateTickets: boolean;
  meetingsEnabled: boolean;
  privacyUrl: string | null;
  retentionDays: number;
}

const TOGGLES = ["aiEnabled", "autoCreateLeads", "autoCreateTickets", "meetingsEnabled"] as const;

/** Guided live chat setup: website, look, knowledge, permissions, privacy, install. Read-only without support.manage. */
export function LivechatSettingsForm({ base, initial, snippet, canManage }: { base: string; initial: LivechatSettingsData; snippet: string; canManage: boolean }) {
  const t = useT();
  const router = useRouter();
  const [f, setF] = useState({
    origins: initial.allowedOrigins.join("\n"),
    brandColor: initial.brandColor,
    position: initial.position,
    assistantName: initial.assistantName,
    greeting: initial.greeting ?? "",
    brainTag: initial.brainTag,
    publicFacts: initial.publicFacts ?? "",
    privacyUrl: initial.privacyUrl ?? "",
    retentionDays: String(initial.retentionDays),
    aiEnabled: initial.aiEnabled,
    autoCreateLeads: initial.autoCreateLeads,
    autoCreateTickets: initial.autoCreateTickets,
    meetingsEnabled: initial.meetingsEnabled,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const set = (k: keyof typeof f, v: string | boolean) => {
    setSaved(false);
    setF((x) => ({ ...x, [k]: v }));
  };

  async function save(extra: Record<string, unknown> = {}) {
    setBusy(true);
    setError(null);
    try {
      await api(`${base}/livechat/settings`, {
        method: "PATCH",
        body: {
          allowedOrigins: f.origins.split(/[\s,]+/).map((x) => x.trim()).filter(Boolean),
          brandColor: f.brandColor,
          position: f.position,
          assistantName: f.assistantName,
          greeting: f.greeting.trim() || null,
          brainTag: f.brainTag,
          publicFacts: f.publicFacts.trim() || null,
          privacyUrl: f.privacyUrl.trim() || null,
          retentionDays: Number(f.retentionDays) || 180,
          aiEnabled: f.aiEnabled,
          autoCreateLeads: f.autoCreateLeads,
          autoCreateTickets: f.autoCreateTickets,
          meetingsEnabled: f.meetingsEnabled,
          ...extra,
        },
      });
      setSaved(true);
      router.refresh();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  async function rotate() {
    if (!window.confirm(t("livechat.settings.rotateConfirm"))) return;
    setBusy(true);
    setError(null);
    try {
      await api(`${base}/livechat/settings/rotate-key`, { body: {} });
      router.refresh();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  const ro = !canManage;
  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <Card>
        <CardHeader title={t("livechat.settings.step1")} description={t("livechat.settings.step1Hint")} />
        <CardBody>
          <Field label={t("livechat.settings.origins")} htmlFor="lc-origins" hint={t("livechat.settings.originsHint")}>
            <Textarea id="lc-origins" rows={3} value={f.origins} disabled={ro} placeholder="https://www.example.com" onChange={(e) => set("origins", e.target.value)} />
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("livechat.settings.step2")} description={t("livechat.settings.step2Hint")} />
        <CardBody className="grid gap-3 sm:grid-cols-2">
          <Field label={t("livechat.settings.assistantName")} htmlFor="lc-name">
            <Input id="lc-name" maxLength={60} required value={f.assistantName} disabled={ro} onChange={(e) => set("assistantName", e.target.value)} />
          </Field>
          <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-3">
            <Field label={t("livechat.settings.brandColor")} htmlFor="lc-color">
              <input id="lc-color" type="color" className="h-9 w-14 cursor-pointer rounded-md border bg-surface" value={f.brandColor} disabled={ro} onChange={(e) => set("brandColor", e.target.value)} />
            </Field>
            <Field label={t("livechat.settings.position")} htmlFor="lc-pos">
              <Select id="lc-pos" value={f.position} disabled={ro} onChange={(e) => set("position", e.target.value)}>
                <option value="right">{t("livechat.settings.positionRight")}</option>
                <option value="left">{t("livechat.settings.positionLeft")}</option>
              </Select>
            </Field>
          </div>
          <Field className="sm:col-span-2" label={t("livechat.settings.greeting")} htmlFor="lc-greeting" hint={t("livechat.settings.greetingHint")}>
            <Textarea id="lc-greeting" rows={2} maxLength={500} value={f.greeting} disabled={ro} onChange={(e) => set("greeting", e.target.value)} />
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("livechat.settings.step3")} description={t("livechat.settings.step3Hint")} />
        <CardBody className="grid gap-3">
          <Field label={t("livechat.settings.publicFacts")} htmlFor="lc-facts" hint={t("livechat.settings.publicFactsHint")}>
            <Textarea id="lc-facts" rows={6} maxLength={8000} value={f.publicFacts} disabled={ro} placeholder={t("livechat.settings.publicFactsPlaceholder")} onChange={(e) => set("publicFacts", e.target.value)} />
          </Field>
          <Field label={t("livechat.settings.brainTag")} htmlFor="lc-tag" hint={t("livechat.settings.brainTagHint")}>
            <Input id="lc-tag" maxLength={40} required value={f.brainTag} disabled={ro} onChange={(e) => set("brainTag", e.target.value.toLowerCase())} />
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("livechat.settings.step4")} description={t("livechat.settings.step4Hint")} />
        <CardBody className="grid gap-3">
          {TOGGLES.map((k) => (
            <label key={k} className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-1" checked={f[k]} disabled={ro} onChange={(e) => set(k, e.target.checked)} />
              <span>
                {t(`livechat.settings.toggles.${k}`)}
                <span className="block text-xs text-muted-foreground">{t(`livechat.settings.toggles.${k}Hint`)}</span>
              </span>
            </label>
          ))}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("livechat.settings.step5")} description={t("livechat.settings.step5Hint")} />
        <CardBody className="grid gap-3 sm:grid-cols-2">
          <Field label={t("livechat.settings.privacyUrl")} htmlFor="lc-privacy" hint={t("livechat.settings.privacyUrlHint")}>
            <Input id="lc-privacy" type="url" maxLength={500} value={f.privacyUrl} disabled={ro} placeholder="https://www.example.com/privacy" onChange={(e) => set("privacyUrl", e.target.value)} />
          </Field>
          <Field label={t("livechat.settings.retentionDays")} htmlFor="lc-retention" hint={t("livechat.settings.retentionHint")}>
            <Input id="lc-retention" type="number" min={7} max={3650} value={f.retentionDays} disabled={ro} onChange={(e) => set("retentionDays", e.target.value)} />
          </Field>
        </CardBody>
      </Card>

      {canManage ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" disabled={busy}>
            {t("common.save")}
          </Button>
          {saved ? (
            <span className="inline-flex items-center gap-1 text-sm text-success" role="status">
              <Check className="size-4" aria-hidden />
              {t("livechat.settings.saved")}
            </span>
          ) : null}
        </div>
      ) : null}
      <FormError error={error} />

      <Card>
        <CardHeader title={t("livechat.settings.step6")} description={t("livechat.settings.step6Hint")} />
        <CardBody className="grid gap-3">
          <pre className="overflow-x-auto rounded-md border bg-surface-2 p-3 text-xs" dir="ltr">
            <code>{snippet}</code>
          </pre>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => {
                void navigator.clipboard?.writeText(snippet).then(() => setCopied(true));
              }}
            >
              {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
              {copied ? t("livechat.settings.copied") : t("livechat.settings.copy")}
            </Button>
            <WidgetPreview publicKey={initial.publicKey} />
            {canManage ? (
              <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => void rotate()}>
                <RefreshCw className="size-4" aria-hidden />
                {t("livechat.settings.rotate")}
              </Button>
            ) : null}
          </div>
          <p className="text-xs text-muted-foreground">{t("livechat.settings.cspHint")}</p>
          {canManage ? (
            initial.enabled ? (
              <Notice tone="success" title={t("livechat.settings.liveTitle")} action={<Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => void save({ enabled: false })}>{t("livechat.settings.turnOff")}</Button>}>
                {t("livechat.settings.liveBody")}
              </Notice>
            ) : (
              <Notice tone="info" title={t("livechat.settings.offTitle")} action={<Button type="button" size="sm" disabled={busy} onClick={() => void save({ enabled: true })}>{t("livechat.settings.turnOn")}</Button>}>
                {t("livechat.settings.offBody")}
              </Notice>
            )
          ) : null}
        </CardBody>
      </Card>
    </form>
  );
}

/** Loads the real widget on this page (same origin is always allowed), so the founder can try it before going live. */
function WidgetPreview({ publicKey }: { publicKey: string }) {
  const t = useT();
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!on) return;
    const s = document.createElement("script");
    s.src = "/api/public/chat/widget.js";
    s.async = true;
    s.dataset.key = publicKey;
    document.body.appendChild(s);
    return () => {
      (window as unknown as { __realyChat?: { destroy(): void } }).__realyChat?.destroy();
      s.remove();
    };
  }, [on, publicKey]);
  return (
    <Button type="button" variant="secondary" size="sm" aria-pressed={on} onClick={() => setOn((v) => !v)}>
      <Eye className="size-4" aria-hidden />
      {on ? t("livechat.settings.previewOff") : t("livechat.settings.preview")}
    </Button>
  );
}
