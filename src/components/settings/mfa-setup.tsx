"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { FormError } from "@/components/form-error";
import { useT } from "@/i18n/client";
import { api } from "@/lib/api-client";

export function MfaSetup({ enabled }: { enabled: boolean }) {
  const t = useT();
  const router = useRouter();
  const [setup, setSetup] = useState<{ secret: string; otpauthUrl: string } | null>(null);
  const [code, setCode] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  if (codes) {
    return (
      <div className="grid gap-3">
        <Notice tone="success">{t("settings.security.enabled")}</Notice>
        <h3 className="font-medium">{t("settings.security.recoveryTitle")}</h3>
        <p className="text-muted-foreground">{t("settings.security.recoveryHint")}</p>
        <ul dir="ltr" className="grid grid-cols-2 gap-2 rounded-md border bg-surface-2 p-3 font-mono text-sm">
          {codes.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      </div>
    );
  }

  if (enabled) {
    return (
      <div className="flex items-center gap-2">
        <ShieldCheck className="size-5 text-success" aria-hidden />
        <span>{t("settings.security.enabled")}</span>
      </div>
    );
  }

  if (!setup) {
    return (
      <div className="grid justify-items-start gap-3">
        <p className="text-muted-foreground">{t("settings.security.off")}</p>
        <FormError error={error} />
        <Button disabled={busy} onClick={() => run(async () => setSetup(await api("/api/v1/auth/mfa/totp/setup", { method: "POST" })))}>
          {t("settings.security.start")}
        </Button>
      </div>
    );
  }

  return (
    <form
      className="grid max-w-lg gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void run(async () => {
          const r = await api<{ recoveryCodes: string[] }>("/api/v1/auth/mfa/totp/confirm", { body: { code } });
          setCodes(r.recoveryCodes);
          router.refresh();
        });
      }}
    >
      <p className="text-muted-foreground">{t("settings.security.scan")}</p>
      <Field label={t("settings.security.secret")} htmlFor="secret">
        <Input id="secret" readOnly dir="ltr" value={setup.secret} className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
      </Field>
      <Field label={t("settings.security.uri")} htmlFor="uri">
        <Input id="uri" readOnly dir="ltr" value={setup.otpauthUrl} className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
      </Field>
      <Field label={t("settings.security.confirmCode")} htmlFor="code">
        <Input id="code" inputMode="numeric" autoComplete="one-time-code" dir="ltr" className="font-mono tracking-widest" value={code} onChange={(e) => setCode(e.target.value.trim())} />
      </Field>
      <FormError error={error} />
      <div>
        <Button type="submit" disabled={busy || code.length !== 6}>
          {t("settings.security.confirm")}
        </Button>
      </div>
    </form>
  );
}
