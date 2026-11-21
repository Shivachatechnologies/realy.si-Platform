"use client";

import { useEffect, useRef, useState } from "react";
import { Landmark, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { FormError } from "@/components/form-error";
import { useAction } from "@/components/automation/use-action";
import { useT } from "@/i18n/client";
import { api } from "@/lib/api-client";

/** "Link a bank": opens Plaid Hosted Link (a full-page redirect to Plaid; no third-party script on Realy's pages). */
export function PlaidLinkButton({ base, locale, relink }: { base: string; locale: string; relink?: boolean }) {
  const t = useT();
  const { busy, error, run } = useAction();
  return (
    <div className="grid gap-2">
      <div>
        <Button type="button" disabled={busy} onClick={() => void run(() => api<{ url: string }>(`${base}/integrations/plaid/bank-link`, { body: { locale } }), (r) => window.location.assign(r.url))}>
          <Landmark aria-hidden />
          {busy ? t("integrations.bank.opening") : relink ? t("integrations.bank.linkAnother") : t("integrations.bank.link")}
        </Button>
      </div>
      <FormError error={error} />
    </div>
  );
}

/** After Plaid redirects back (?plaid=return): finish the link once, then show what was linked. */
export function PlaidLinkCompletion({ base, pending }: { base: string; pending: boolean }) {
  const t = useT();
  const { error, run } = useAction();
  const [done, setDone] = useState<number | null>(null);
  const started = useRef(false);
  useEffect(() => {
    if (!pending || started.current) return;
    started.current = true;
    void run(() => api<{ linked: { itemId: string }[] }>(`${base}/integrations/plaid/bank-link`, { method: "PUT", body: {} }), (r) => setDone(r.linked.length));
  }, [base, pending, run]);
  if (error) return <FormError error={error} />;
  if (done === null) return pending ? <Notice tone="info">{t("integrations.bank.finishing")}</Notice> : null;
  return <Notice tone={done ? "success" : "warning"}>{done ? t("integrations.bank.linked", { count: done }) : t("integrations.bank.nothingLinked")}</Notice>;
}

export function RemoveBankButton({ base, itemId, name }: { base: string; itemId: string; name: string }) {
  const t = useT();
  const { busy, error, run } = useAction();
  return (
    <div className="grid justify-items-end gap-1">
      <Button
        type="button"
        size="sm"
        variant="danger"
        disabled={busy}
        onClick={() => {
          if (confirm(t("integrations.bank.removeConfirm", { name }))) void run(() => api(`${base}/integrations/plaid/bank-items/${encodeURIComponent(itemId)}`, { method: "DELETE" }));
        }}
      >
        <Trash2 aria-hidden />
        {t("integrations.bank.remove")}
      </Button>
      <FormError error={error} />
    </div>
  );
}
