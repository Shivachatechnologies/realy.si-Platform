"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Save } from "lucide-react";
import { FormError } from "@/components/form-error";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useT } from "@/i18n/client";
import { api } from "@/lib/api-client";

/** Company WhatsApp reply settings: approved message templates (webhooks and the Meta app secret are Realy's). */
export function ChannelSettingsForm({
  apiBase,
  provider,
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
  const [v, setV] = useState({ metaTemplateName: initial.metaTemplateName, metaTemplateLanguage: initial.metaTemplateLanguage, twilioContentSid: initial.twilioContentSid });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);
  const save = async () => {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await api(`${apiBase}/briefing/channels`, { method: "PUT", body: { metaTemplateName: v.metaTemplateName, metaTemplateLanguage: v.metaTemplateLanguage, twilioContentSid: v.twilioContentSid } });
      setSaved(true);
      router.refresh();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="grid gap-5">
      {/* Webhook URLs and the Meta app secret are Realy's (Control Center → Platform keys); nothing to paste here. */}
      {canManage ? (
        <>
          {provider !== "twilio" ? (
            <div className="grid gap-4 sm:grid-cols-2">
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
