"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { ExternalLink, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/form-error";
import { useI18n } from "@/i18n/client";
import { formatNumber } from "@/i18n/format";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { PERSONALITIES, STT_CHOICES, TTS_CHOICES, VOICE_LANGUAGES } from "@/server/modules/voiceos/catalog";
import type { VoiceOS } from "./use-voice-os";

const selectCls = "h-9 w-full rounded-md border bg-surface px-2 text-sm focus-visible:outline-2 focus-visible:outline-primary";

function Row({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="grid gap-1 text-sm">
      <span className="font-medium">{label}</span>
      {children}
      {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
    </label>
  );
}

function Toggle({ checked, onChange, label, hint, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: ReactNode; disabled?: boolean }) {
  return (
    <label className={cn("flex items-start gap-3 text-sm", disabled && "opacity-60")}>
      <input type="checkbox" className="mt-0.5 size-4 accent-[var(--primary)]" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="grid gap-0.5">
        <span className="font-medium">{label}</span>
        {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
      </span>
    </label>
  );
}

/** Voice OS preferences: privacy (history, wake word), voice, language, providers, minutes. */
export function VoiceSettingsPanel({ voice, base }: { voice: VoiceOS; base: string }) {
  const { t, locale } = useI18n();
  const [clearing, setClearing] = useState(false);
  const [cleared, setCleared] = useState<number | null>(null);
  const [error, setError] = useState<unknown>(null);
  const s = voice.settings;
  const b = voice.boot;
  if (!s || !b) return null;
  const connected = (p: string) => (b.providers.stt as string[]).includes(p) || (b.providers.tts as string[]).includes(p);
  const providerLabel = (p: string) => (p === "auto" || p === "browser" ? t(`jarvis.settings.provider.${p}`) : `${t(`jarvis.providers.${p}`)}${connected(p) ? "" : ` · ${t("jarvis.settings.notConnected")}`}`);
  const clear = async () => {
    setClearing(true);
    setError(null);
    try {
      const out = await api<{ deleted: number }>(`${base}/voiceos/sessions`, { method: "DELETE" });
      setCleared(out.deleted);
      voice.refresh();
    } catch (e) {
      setError(e);
    } finally {
      setClearing(false);
    }
  };
  return (
    <div className="grid gap-5">
      <section className="grid gap-3" aria-labelledby="jv-privacy">
        <h3 id="jv-privacy" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t("jarvis.settings.privacy")}</h3>
        <Toggle checked={s.historyEnabled} onChange={(v) => void voice.updateSettings({ historyEnabled: v })} label={t("jarvis.settings.history")} hint={t("jarvis.settings.historyHint")} />
        <Toggle
          checked={s.wakeWordEnabled}
          disabled={!voice.recognitionAvailable}
          onChange={(v) => void voice.updateSettings({ wakeWordEnabled: v })}
          label={t("jarvis.settings.wake")}
          hint={voice.recognitionAvailable ? t("jarvis.settings.wakeHint") : t("jarvis.settings.wakeUnsupported")}
        />
        <Toggle checked={s.speakReplies} onChange={(v) => void voice.updateSettings({ speakReplies: v })} label={t("jarvis.settings.speak")} />
      </section>
      <section className="grid gap-3" aria-labelledby="jv-voice">
        <h3 id="jv-voice" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t("jarvis.settings.voice")}</h3>
        <Row label={t("jarvis.settings.personality")} hint={t(`jarvis.personalities.${s.personality}.summary`)}>
          <select className={selectCls} value={s.personality} onChange={(e) => void voice.updateSettings({ personality: e.target.value })}>
            {PERSONALITIES.map((p) => (
              <option key={p.key} value={p.key}>
                {t(`jarvis.personalities.${p.key}.name`)}
              </option>
            ))}
          </select>
        </Row>
        <Row label={t("jarvis.settings.language")}>
          <select className={selectCls} value={s.language} onChange={(e) => void voice.updateSettings({ language: e.target.value as typeof s.language })}>
            {VOICE_LANGUAGES.map((l) => (
              <option key={l} value={l}>
                {t(`jarvis.languages.${l}`)}
              </option>
            ))}
          </select>
        </Row>
      </section>
      <section className="grid gap-3" aria-labelledby="jv-providers">
        <h3 id="jv-providers" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t("jarvis.settings.providers")}</h3>
        <Row label={t("jarvis.settings.stt")} hint={voice.providerStt ? t("jarvis.settings.sttStreaming") : t("jarvis.settings.browserHint")}>
          <select className={selectCls} value={s.sttProvider} onChange={(e) => void voice.updateSettings({ sttProvider: e.target.value as typeof s.sttProvider })}>
            {STT_CHOICES.map((p) => (
              <option key={p} value={p}>
                {providerLabel(p)}
              </option>
            ))}
          </select>
        </Row>
        <Row label={t("jarvis.settings.tts")} hint={voice.providerTts ? undefined : t("jarvis.settings.browserTtsHint")}>
          <select className={selectCls} value={s.ttsProvider} onChange={(e) => void voice.updateSettings({ ttsProvider: e.target.value as typeof s.ttsProvider })}>
            {TTS_CHOICES.map((p) => (
              <option key={p} value={p}>
                {providerLabel(p)}
              </option>
            ))}
          </select>
        </Row>
        {!b.providers.stt.length || !b.providers.tts.length ? (
          <p className="text-xs text-muted-foreground">
            {t("jarvis.settings.connectHint")}{" "}
            {b.canManageIntegrations ? (
              <Link href={`/${locale}/integrations`} className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
                {t("jarvis.settings.openIntegrations")}
                <ExternalLink className="size-3" aria-hidden />
              </Link>
            ) : (
              t("jarvis.settings.askAdmin")
            )}
          </p>
        ) : null}
        <p className="text-xs text-muted-foreground">
          {b.minutes.limit === null
            ? t("jarvis.settings.minutesUnlimited", { used: formatNumber(b.minutes.used, locale) })
            : t("jarvis.settings.minutes", { used: formatNumber(b.minutes.used, locale), limit: formatNumber(b.minutes.limit, locale) })}
        </p>
      </section>
      <section className="grid gap-2" aria-labelledby="jv-history">
        <h3 id="jv-history" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t("jarvis.settings.stored")}</h3>
        <p className="text-xs text-muted-foreground">{t("jarvis.settings.storedHint", { count: b.sessions.reduce((n, x) => n + x.turns, 0) })}</p>
        <div>
          <Button type="button" variant="secondary" size="sm" loading={clearing} onClick={() => void clear()}>
            <Trash2 aria-hidden />
            {t("jarvis.settings.clear")}
          </Button>
        </div>
        {cleared !== null ? <p role="status" className="text-xs text-success">{t("jarvis.settings.cleared", { count: cleared })}</p> : null}
        <FormError error={error} />
      </section>
    </div>
  );
}
