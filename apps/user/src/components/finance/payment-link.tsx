"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { FormError } from "@/components/form-error";
import { useT } from "@/i18n/client";
import { api } from "@/lib/api-client";
import { CopyLink } from "./billing-actions";

/** Online payment link of an invoice: create it through the connected provider (Razorpay / Stripe) and copy it. */
export function PaymentLinkPanel({ endpoint, locale, url, provider, canCreate }: { endpoint: string; locale: string; url: string | null; provider: string | null; canCreate: boolean }) {
  const t = useT();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const create = async () => {
    setBusy(true);
    setError(null);
    setFailure(null);
    try {
      const r = await api<{ ok: boolean; error?: string; url: string | null }>(endpoint, { body: {} });
      if (r.ok) router.refresh();
      else setFailure(r.error ?? "not_connected");
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="grid gap-2">
      {url ? (
        <>
          <p className="text-xs text-muted-foreground">{t("finance.os.payLinkReady", { provider: provider ?? "—" })}</p>
          <CopyLink url={url} />
        </>
      ) : (
        <p className="text-xs text-muted-foreground">{t("finance.os.payLinkHint")}</p>
      )}
      {canCreate ? (
        <div>
          <Button type="button" size="sm" variant={url ? "ghost" : "default"} loading={busy} onClick={() => void create()}>
            <Link2 aria-hidden />
            {url ? t("finance.os.payLinkRecreate") : t("finance.os.payLinkCreate")}
          </Button>
        </div>
      ) : null}
      {failure ? (
        failure === "not_connected" ? (
          <Notice tone="warning" action={<Link href={`/${locale}/integrations`} className="text-xs underline">{t("finance.os.payLinkConnect")}</Link>}>
            {t("finance.os.payLinkNotConnected")}
          </Notice>
        ) : (
          <Notice tone="danger">{t("finance.os.payLinkFailed", { error: failure })}</Notice>
        )
      ) : null}
      <FormError error={error} />
    </div>
  );
}
