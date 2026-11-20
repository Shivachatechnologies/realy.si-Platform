"use client";

import { useEffect, useRef, useState } from "react";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { FormError } from "@/components/form-error";
import { useI18n } from "@/i18n/client";
import { api } from "@/lib/api-client";
import { useAction } from "./client";

/** Records a read receipt once when the page is viewed. */
export function MarkRead({ path }: { path: string }) {
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    void api(path, { body: {} }).catch(() => undefined);
  }, [path]);
  return null;
}

/** Post a record to the connected Slack / Teams channel; shows the provider's truthful outcome. */
export function ShareToChat({ base, subjectType, subjectId, connected }: { base: string; subjectType: "announcement" | "meeting"; subjectId: string; connected: { slack: boolean; microsoft_teams: boolean } }) {
  const { t, locale } = useI18n();
  const [result, setResult] = useState<{ status: string; error: string | null } | null>(null);
  const { busy, error, run } = useAction();
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap gap-2">
        {(["slack", "microsoft_teams"] as const).map((p) => (
          <Button key={p} type="button" size="sm" variant="secondary" disabled={busy} onClick={() => void run(() => api<{ status: string; error: string | null }>(`${base}/comms/share`, { body: { provider: p, subjectType, subjectId } }), setResult)}>
            <Send aria-hidden />
            {t(`communication.share.${p}`)}
            {!connected[p] ? <span className="text-[10px] text-muted-foreground">({t("common.notConnected")})</span> : null}
          </Button>
        ))}
      </div>
      {result ? (
        <Notice tone={result.status === "SENT" ? "success" : result.status === "FAILED" ? "danger" : "warning"}>
          {t(`communication.share.status.${result.status}`)}
          {result.status === "NOT_CONNECTED" ? (
            <>
              {" "}
              <a className="underline" href={`/${locale}/integrations`}>
                {t("communication.connectIntegrations")}
              </a>
            </>
          ) : null}
          {result.error ? <span className="ms-1 font-mono text-[11px] opacity-70">{result.error}</span> : null}
        </Notice>
      ) : null}
      <FormError error={error} />
    </div>
  );
}
