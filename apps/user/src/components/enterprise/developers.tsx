"use client";

import { useState } from "react";
import { Copy, KeyRound, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { FormError } from "@/components/form-error";
import { useI18n } from "@/i18n/client";
import { api } from "@/lib/api-client";
import { PermissionMatrix, type PermissionGroup } from "./roles";
import { useAction } from "./use-action";

const EXPIRY = [30, 90, 180, 365] as const;

export function CreateApiKey({ orgId, groups, held }: { orgId: string; groups: PermissionGroup[]; held: string[] }) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [expiry, setExpiry] = useState<string>("90");
  const [scopes, setScopes] = useState<string[]>([]);
  const [created, setCreated] = useState<{
    secret: string;
    name: string;
  } | null>(null);
  const [copied, setCopied] = useState(false);
  const a = useAction();
  if (created) {
    return (
      <div className="grid gap-2">
        <Notice tone="success">{t("enterprise.developers.createdOnce", { name: created.name })}</Notice>
        <div className="flex gap-2">
          <Input readOnly dir="ltr" className="font-mono text-xs" value={created.secret} onFocus={(e) => e.currentTarget.select()} aria-label={t("enterprise.developers.secret")} />
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              void navigator.clipboard.writeText(created.secret).then(() => setCopied(true));
            }}
          >
            <Copy aria-hidden />
            {copied ? t("enterprise.developers.copied") : t("enterprise.developers.copy")}
          </Button>
        </div>
        <div>
          <Button type="button" variant="ghost" onClick={() => (setCreated(null), setCopied(false))}>
            {t("enterprise.developers.done")}
          </Button>
        </div>
      </div>
    );
  }
  return (
    <form
      className="grid gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        void a.run(
          () =>
            api<{ secret: string; name: string }>(`/api/v1/organizations/${orgId}/enterprise/api-keys`, {
              body: {
                name,
                scopes,
                expiresInDays: expiry === "never" ? null : Number(expiry),
              },
            }),
          (r) => {
            setCreated({ secret: r.secret, name: r.name });
            setName("");
            setScopes([]);
          },
        );
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("enterprise.developers.keyName")} htmlFor="key-name" error={a.fields.name}>
          <Input id="key-name" value={name} maxLength={80} required onChange={(e) => setName(e.target.value)} placeholder={t("enterprise.developers.keyNamePlaceholder")} />
        </Field>
        <Field label={t("enterprise.developers.expiry")} htmlFor="key-exp">
          <Select id="key-exp" value={expiry} onChange={(e) => setExpiry(e.target.value)}>
            {EXPIRY.map((d) => (
              <option key={d} value={d}>
                {t("enterprise.developers.days", { count: d })}
              </option>
            ))}
            <option value="never">{t("enterprise.developers.never")}</option>
          </Select>
        </Field>
      </div>
      <div className="grid gap-1.5">
        <p className="text-sm font-medium">{t("enterprise.developers.scopes")}</p>
        <p className="text-xs text-muted-foreground">{t("enterprise.developers.scopesHint")}</p>
        <PermissionMatrix groups={groups} held={held} value={scopes} onChange={setScopes} />
      </div>
      <FormError error={a.error} />
      <div>
        <Button type="submit" disabled={a.busy || !name || scopes.length === 0}>
          <KeyRound aria-hidden />
          {t("enterprise.developers.create")}
        </Button>
      </div>
    </form>
  );
}

export function RevokeKeyButton({ orgId, keyId }: { orgId: string; keyId: string }) {
  const { t } = useI18n();
  const [confirm, setConfirm] = useState(false);
  const a = useAction();
  if (!confirm)
    return (
      <Button size="sm" variant="ghost" onClick={() => setConfirm(true)}>
        <Trash2 aria-hidden />
        {t("enterprise.developers.revoke")}
      </Button>
    );
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <Button
        size="sm"
        variant="danger"
        disabled={a.busy}
        onClick={() =>
          void a.run(() =>
            api(`/api/v1/organizations/${orgId}/enterprise/api-keys/${keyId}`, {
              method: "DELETE",
            }),
          )
        }
      >
        {t("enterprise.developers.confirmRevoke")}
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setConfirm(false)}>
        {t("common.cancel")}
      </Button>
      <FormError error={a.error} />
    </span>
  );
}
