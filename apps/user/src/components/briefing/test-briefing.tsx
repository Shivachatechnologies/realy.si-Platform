"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Send } from "lucide-react";
import { FormError } from "@/components/form-error";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n/client";
import { api } from "@/lib/api-client";

type Channel = "IN_APP" | "EMAIL" | "WHATSAPP";

/** "Send me a test briefing": builds yesterday's briefing now and delivers it on the chosen channels. */
export function TestBriefingButton({ apiBase, channels, whatsappReady, variant = "default", size = "default" }: { apiBase: string; channels: Channel[]; whatsappReady: boolean; variant?: "default" | "secondary"; size?: "default" | "sm" }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [picked, setPicked] = useState<Channel[]>(channels.filter((c) => c !== "WHATSAPP" || whatsappReady));
  const toggle = (c: Channel) => setPicked((p) => (p.includes(c) ? p.filter((x) => x !== c) : [...p, c]));
  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ id: string }>(`${apiBase}/briefing/test`, { body: { channels: picked.length ? picked : ["IN_APP"] } });
      router.push(`/${locale}/briefing/${r.id}`);
      router.refresh();
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };
  return (
    <div className="grid gap-2">
      <fieldset className="flex flex-wrap items-center gap-3 text-sm">
        <legend className="sr-only">{t("briefing.test.channels")}</legend>
        {(["IN_APP", "EMAIL", "WHATSAPP"] as const).map((c) => (
          <label key={c} className="inline-flex items-center gap-1.5">
            <input type="checkbox" checked={picked.includes(c)} disabled={c === "IN_APP" || (c === "WHATSAPP" && !whatsappReady)} onChange={() => toggle(c)} />
            {t(`briefing.channels.${c}`)}
          </label>
        ))}
      </fieldset>
      <div>
        <Button onClick={send} loading={busy} variant={variant} size={size}>
          <Send aria-hidden className="rtl:-scale-x-100" />
          {t("briefing.test.button")}
        </Button>
      </div>
      <FormError error={error} />
    </div>
  );
}
