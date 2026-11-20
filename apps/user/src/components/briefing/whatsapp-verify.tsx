"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { MessageCircle, RefreshCw } from "lucide-react";
import { FormError } from "@/components/form-error";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/client";
import { api } from "@/lib/api-client";

interface Started {
  code: string;
  text: string;
  provider: string;
  businessNumber: string | null;
  link: string | null;
  expiresAt: string;
}

/**
 * Prove the number is yours: send "REALY <code>" from your WhatsApp to the business number. The page refreshes until
 * the signed webhook confirms it (the code alone, typed elsewhere, does not verify anything).
 */
export function WhatsAppVerify({ apiBase }: { apiBase: string }) {
  const t = useT();
  const router = useRouter();
  const [started, setStarted] = useState<Started | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    if (!started) return;
    const id = setInterval(() => router.refresh(), 5000);
    const stop = setTimeout(() => clearInterval(id), 15 * 60_000);
    return () => {
      clearInterval(id);
      clearTimeout(stop);
    };
  }, [started, router]);
  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      setStarted(await api<Started>(`${apiBase}/briefing/whatsapp/verify`, { body: {} }));
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="grid gap-3 rounded-xl border border-dashed p-4">
      {started ? (
        <>
          <p className="text-sm">{started.businessNumber ? t("briefing.verify.send", { number: started.businessNumber }) : t("briefing.verify.sendMeta")}</p>
          <p className="justify-self-start rounded-lg bg-muted px-3 py-2 font-mono text-lg tracking-wider" dir="ltr">
            {started.text}
          </p>
          <div className="flex flex-wrap gap-2">
            {started.link ? (
              <Button asChild size="sm">
                <a href={started.link} target="_blank" rel="noreferrer noopener">
                  <MessageCircle aria-hidden />
                  {t("briefing.verify.open")}
                </a>
              </Button>
            ) : null}
            <Button size="sm" variant="secondary" onClick={start} loading={busy}>
              <RefreshCw aria-hidden />
              {t("briefing.verify.newCode")}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground" aria-live="polite">{t("briefing.verify.waiting")}</p>
        </>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">{t("briefing.verify.intro")}</p>
          <div>
            <Button size="sm" onClick={start} loading={busy}>
              <MessageCircle aria-hidden />
              {t("briefing.verify.start")}
            </Button>
          </div>
        </>
      )}
      <FormError error={error} />
    </div>
  );
}
