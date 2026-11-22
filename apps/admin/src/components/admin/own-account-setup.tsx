"use client";

import { useState } from "react";
import { KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { useT } from "@/i18n/client";
import { ActionDialog, useAdminAction } from "./action-dialog";

export interface SetupField {
  key: string;
  secret: boolean;
  required: boolean;
  placeholder?: string;
  labelKey?: string;
}

/**
 * Realy-team setup / rotation of an organization's own provider credentials (docs/integrations.md §7). Values are sent
 * once to the admin API, verified there with the provider's connection test and stored encrypted; they are never shown
 * again, and the inputs are cleared after saving. A reason is required (audit log).
 */
export function OwnAccountSetupButton({ orgId, companyId, provider, name, fields, rotate, hint }: { orgId: string; companyId: string; provider: string; name: string; fields: SetupField[]; rotate: boolean; hint?: string }) {
  const t = useT();
  const run = useAdminAction();
  const [values, setValues] = useState<Record<string, string>>({});
  const missing = fields.some((f) => f.required && !(values[f.key] ?? "").trim());
  const label = rotate ? t("admin.ownAccounts.rotate") : t("admin.ownAccounts.setUp");
  return (
    <ActionDialog
      trigger={
        <Button size="sm" variant={rotate ? "secondary" : "default"}>
          <KeyRound aria-hidden />
          {label}
        </Button>
      }
      title={`${label}: ${name}`}
      description={t("admin.ownAccounts.dialogHint", { name })}
      confirmLabel={t("admin.ownAccounts.verifyAndSave")}
      canSubmit={!missing}
      onConfirm={async (reason) => {
        const sent = Object.fromEntries(Object.entries(values).filter(([, v]) => v.trim()));
        await run(`/api/v1/admin/organizations/${orgId}/own-accounts/${provider}`, "PUT", { companyId, fields: sent, reason });
        setValues({});
      }}
    >
      <Notice tone="info">{t("admin.ownAccounts.neverShown")}</Notice>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      {fields.map((f) => {
        const id = `own-${provider}-${f.key}`;
        return (
          <Field key={f.key} label={`${t(`integrations.fields.${f.labelKey ?? f.key}`)}${f.required ? "" : ` (${t("admin.ownAccounts.optional")})`}`} htmlFor={id}>
            <Input
              id={id}
              type={f.secret ? "password" : "text"}
              autoComplete="off"
              spellCheck={false}
              placeholder={f.placeholder}
              value={values[f.key] ?? ""}
              onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
              className="font-mono"
            />
          </Field>
        );
      })}
    </ActionDialog>
  );
}
