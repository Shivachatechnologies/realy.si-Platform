"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Select, Textarea } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { FormError } from "@/components/form-error";
import { useI18n } from "@/i18n/client";
import { api } from "@/lib/api-client";
import { useAction } from "./use-action";

const TIMEOUTS = [null, 60, 240, 480, 720, 1440, 4320, 10080] as const;

export function OrgSecurityForm({
  orgId,
  initial,
  membersWithoutMfa,
  currentIp,
}: {
  orgId: string;
  initial: {
    requireMfa: boolean;
    sessionTimeoutMinutes: number | null;
    ipAllowlist: string[];
  };
  membersWithoutMfa: number;
  currentIp: string | null;
}) {
  const { t } = useI18n();
  const [requireMfa, setRequireMfa] = useState(initial.requireMfa);
  const [timeout, setTimeoutValue] = useState<string>(initial.sessionTimeoutMinutes === null ? "" : String(initial.sessionTimeoutMinutes));
  const [ips, setIps] = useState(initial.ipAllowlist.join("\n"));
  const a = useAction();
  const options: (number | null)[] = [...TIMEOUTS];
  if (initial.sessionTimeoutMinutes && !options.includes(initial.sessionTimeoutMinutes)) options.push(initial.sessionTimeoutMinutes);
  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void a.run(() =>
          api(`/api/v1/organizations/${orgId}/enterprise/security`, {
            method: "PUT",
            body: {
              requireMfa,
              sessionTimeoutMinutes: timeout === "" ? null : Number(timeout),
              ipAllowlist: ips
                .split(/[\n,]/)
                .map((x) => x.trim())
                .filter(Boolean),
            },
          }),
        );
      }}
    >
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-1" checked={requireMfa} onChange={(e) => setRequireMfa(e.target.checked)} />
        <span>
          <span className="font-medium">{t("enterprise.security.requireMfa")}</span>
          <span className="block text-xs text-muted-foreground">{t("enterprise.security.requireMfaHint")}</span>
          {requireMfa && membersWithoutMfa > 0 ? (
            <span className="block text-xs text-warning">
              {t("enterprise.security.membersWithoutMfa", {
                count: membersWithoutMfa,
              })}
            </span>
          ) : null}
        </span>
      </label>
      <Field label={t("enterprise.security.sessionTimeout")} htmlFor="sec-timeout" hint={t("enterprise.security.sessionTimeoutHint")}>
        <Select id="sec-timeout" value={timeout} onChange={(e) => setTimeoutValue(e.target.value)} className="max-w-xs">
          {options.map((m) => (
            <option key={m ?? "default"} value={m ?? ""}>
              {m === null
                ? t("enterprise.security.platformDefault")
                : m < 1440
                  ? t("enterprise.security.hours", { count: m / 60 })
                  : t("enterprise.security.days", { count: m / 1440 })}
            </option>
          ))}
        </Select>
      </Field>
      <Field
        label={t("enterprise.security.ipAllowlist")}
        htmlFor="sec-ips"
        hint={t("enterprise.security.ipAllowlistHint", {
          ip: currentIp ?? "—",
        })}
        error={a.fields.ipAllowlist}
      >
        <Textarea id="sec-ips" dir="ltr" rows={4} className="font-mono text-xs" value={ips} onChange={(e) => setIps(e.target.value)} placeholder={"203.0.113.0/24\n2001:db8::1"} />
      </Field>
      <FormError error={a.error} />
      {a.done ? <Notice tone="success">{t("enterprise.saved")}</Notice> : null}
      <div>
        <Button type="submit" disabled={a.busy}>
          {t("common.save")}
        </Button>
      </div>
    </form>
  );
}

export function RevokeSessionButton({ orgId, sessionId, current }: { orgId: string; sessionId: string; current: boolean }) {
  const { t } = useI18n();
  const a = useAction();
  return (
    <span className="inline-flex flex-col items-end gap-1">
      <Button
        size="sm"
        variant="ghost"
        disabled={a.busy || current}
        title={current ? t("enterprise.security.thisSession") : undefined}
        onClick={() => void a.run(() => api(`/api/v1/organizations/${orgId}/enterprise/sessions/${sessionId}`, { method: "DELETE" }))}
      >
        {t("enterprise.security.revoke")}
      </Button>
      <FormError error={a.error} />
    </span>
  );
}
