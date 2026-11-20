"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, Save } from "lucide-react";
import { FormError } from "@/components/form-error";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useT } from "@/i18n/client";
import { api } from "@/lib/api-client";

function CopyRow({ label, value }: { label: string; value: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  return (
    <div className="grid gap-1">
      <span className="text-[13px] font-medium">{label}</span>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-md bg-muted px-2 py-1.5 text-xs" dir="ltr">
          {value}
        </code>
        <Button
          size="sm"
          variant="ghost"
          aria-label={`${t("briefing.channelSettings.copy")} ${label}`}
          onClick={async () => {
            await navigator.clipboard.writeText(value).catch(() => undefined);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          <Copy aria-hidden />
          {copied ? t("briefing.channelSettings.copied") : t("briefing.channelSettings.copy")}
        </Button>
      </div>
    </div>
  );
}

/** Company WhatsApp reply settings: webhook URLs to paste into Twilio / Meta, Meta app secret, approved templates. */
export function ChannelSettingsForm({
  apiBase,
  provider,
  webhooks,
  canManage,
  initial,
}: {
  apiBase: string;
  provider: string | null;
  webhooks: { twilio: string; meta: string; metaVerifyToken: string | null } | null;
  canManage: boolean;
  initial: { metaAppSecretSet: boolean; metaTemplateName: string; metaTemplateLanguage: string; twilioContentSid: string };
}) {
  const t = useT();
  const router = useRouter();
  const [v, setV] = useState({ metaAppSecret: "", metaTemplateName: initial.metaTemplateName, metaTemplateLanguage: initial.metaTemplateLanguage, twilioContentSid: initial.twilioContentSid });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);
  const save = async () => {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await api(`${apiBase}/briefing/channels`, { method: "PUT", body: { ...v, metaAppSecret: v.metaAppSecret || undefined } });
      setSaved(true);
      setV((p) => ({ ...p, metaAppSecret: "" }));
      router.refresh();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="grid gap-5">
      {webhooks ? (
        <div className="grid gap-3">
          {provider !== "whatsapp" ? <CopyRow label={t("briefing.channelSettings.twilioUrl")} value={webhooks.twilio} /> : null}
          {provider !== "twilio" ? <CopyRow label={t("briefing.channelSettings.metaUrl")} value={webhooks.meta} /> : null}
          {provider !== "twilio" && webhooks.metaVerifyToken ? <CopyRow label={t("briefing.channelSettings.verifyToken")} value={webhooks.metaVerifyToken} /> : null}
          <p className="text-xs text-muted-foreground">{t("briefing.channelSettings.webhookHint")}</p>
        </div>
      ) : null}
      {canManage ? (
        <>
          {provider !== "twilio" ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("briefing.channelSettings.appSecret")} htmlFor="c-secret" hint={initial.metaAppSecretSet ? t("briefing.channelSettings.appSecretSet") : t("briefing.channelSettings.appSecretHint")}>
                <Input id="c-secret" type="password" autoComplete="off" value={v.metaAppSecret} onChange={(e) => setV({ ...v, metaAppSecret: e.target.value })} />
              </Field>
              <div className="grid grid-cols-[1fr_7rem] gap-2">
                <Field label={t("briefing.channelSettings.metaTemplate")} htmlFor="c-tpl" hint={t("briefing.channelSettings.metaTemplateHint")}>
                  <Input id="c-tpl" dir="ltr" placeholder="daily_briefing" value={v.metaTemplateName} onChange={(e) => setV({ ...v, metaTemplateName: e.target.value })} />
                </Field>
                <Field label={t("briefing.channelSettings.language")} htmlFor="c-lang">
                  <Input id="c-lang" dir="ltr" placeholder="en_US" value={v.metaTemplateLanguage} onChange={(e) => setV({ ...v, metaTemplateLanguage: e.target.value })} />
                </Field>
              </div>
            </div>
          ) : null}
          {provider !== "whatsapp" ? (
            <Field label={t("briefing.channelSettings.twilioContent")} htmlFor="c-hx" hint={t("briefing.channelSettings.twilioContentHint")} className="sm:max-w-md">
              <Input id="c-hx" dir="ltr" placeholder="HX…" value={v.twilioContentSid} onChange={(e) => setV({ ...v, twilioContentSid: e.target.value })} />
            </Field>
          ) : null}
          <FormError error={error} />
          <div className="flex items-center gap-3">
            <Button size="sm" onClick={save} loading={busy}>
              <Save aria-hidden />
              {t("briefing.settings.save")}
            </Button>
            {saved ? <span className="text-sm text-success">{t("briefing.settings.saved")}</span> : null}
          </div>
        </>
      ) : (
        <p className="text-xs text-muted-foreground">{t("briefing.channelSettings.readOnly")}</p>
      )}
    </div>
  );
}
