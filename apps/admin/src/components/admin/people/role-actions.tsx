"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { KeyRound, ShieldPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select } from "@/components/ui/input";
import { FormError } from "@/components/form-error";
import { useI18n } from "@/i18n/client";
import { ActionDialog, useAdminAction } from "../action-dialog";

function MfaField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { t } = useI18n();
  return (
    <Field label={t("admin.roles.mfaCode")} htmlFor="role-mfa" hint={t("admin.roles.mfaHint")}>
      <Input id="role-mfa" inputMode="numeric" autoComplete="one-time-code" value={value} onChange={(e) => onChange(e.target.value)} className="font-mono" maxLength={20} />
    </Field>
  );
}

export function RoleGrant({ roles }: { roles: { key: string; name: string }[] }) {
  const { t } = useI18n();
  const run = useAdminAction();
  const [email, setEmail] = useState("");
  const [roleKey, setRoleKey] = useState(roles[0]?.key ?? "");
  const [code, setCode] = useState("");
  return (
    <ActionDialog
      trigger={
        <Button size="sm">
          <ShieldPlus />
          {t("admin.roles.grant")}
        </Button>
      }
      title={t("admin.roles.grant")}
      description={t("admin.roles.grantHint")}
      confirmLabel={t("admin.roles.grant")}
      canSubmit={/.+@.+\..+/.test(email) && !!roleKey}
      onConfirm={async (reason) => {
        await run("/api/v1/admin/roles", "POST", { email, roleKey, reason, mfaCode: code || undefined });
        setCode("");
      }}
    >
      <Field label={t("admin.roles.email")} htmlFor="role-email">
        <Input id="role-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </Field>
      <Field label={t("admin.roles.role")} htmlFor="role-key">
        <Select id="role-key" value={roleKey} onChange={(e) => setRoleKey(e.target.value)}>
          {roles.map((r) => (
            <option key={r.key} value={r.key}>
              {r.name}
            </option>
          ))}
        </Select>
      </Field>
      <MfaField value={code} onChange={setCode} />
    </ActionDialog>
  );
}

export function RoleRevoke({ assignmentId, who, role }: { assignmentId: string; who: string; role: string }) {
  const { t } = useI18n();
  const run = useAdminAction();
  const [code, setCode] = useState("");
  return (
    <ActionDialog
      trigger={
        <Button size="sm" variant="ghost" className="text-danger">
          {t("admin.roles.revoke")}
        </Button>
      }
      title={t("admin.roles.revokeTitle", { role, who })}
      confirmLabel={t("admin.roles.revoke")}
      danger
      onConfirm={async (reason) => {
        await run(`/api/v1/admin/roles/${assignmentId}`, "DELETE", { reason, mfaCode: code || undefined });
        setCode("");
      }}
    >
      <MfaField value={code} onChange={setCode} />
    </ActionDialog>
  );
}

// ───────────── Support: view as ─────────────

/** Ask for the user and the reason; the page then renders the read-only summary (POST is audited). */
export function ViewAsForm({ initialUserId }: { initialUserId?: string }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [userId, setUserId] = useState(initialUserId ?? "");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<unknown>(null);
  return (
    <form
      className="flex flex-wrap items-end gap-2 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        if (!/^[0-9a-f-]{36}$/i.test(userId.trim())) return setError(new Error(t("admin.roles.viewAs.invalidUser")));
        router.push(`/${locale}/roles/view-as?user=${userId.trim()}&reason=${encodeURIComponent(reason)}`);
      }}
    >
      <Field label={t("admin.roles.viewAs.userId")} htmlFor="va-user" className="min-w-72 flex-1">
        <Input id="va-user" value={userId} onChange={(e) => setUserId(e.target.value)} className="font-mono" />
      </Field>
      <Field label={t("common.reason")} htmlFor="va-reason" className="min-w-56 flex-1">
        <Input id="va-reason" required minLength={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
      <Button type="submit" disabled={reason.trim().length < 3}>
        <KeyRound />
        {t("admin.roles.viewAs.open")}
      </Button>
      <FormError error={error} />
    </form>
  );
}
