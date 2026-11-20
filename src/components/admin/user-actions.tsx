"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Select } from "@/components/ui/input";
import { useI18n } from "@/i18n/client";
import { api } from "@/lib/api-client";
import { ActionButton, ActionDialog, useAdminAction } from "./action-dialog";

/** Security actions on one user: revoke sessions, safe delete, platform roles. The server re-checks everything. */
export function UserActions({ userId, email, deleted, canManage }: { userId: string; email: string; deleted: boolean; canManage: boolean }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  if (!canManage || deleted) return null;
  return (
    <div className="flex flex-wrap gap-2">
      <ActionButton label={t("admin.users.revokeSessions")} title={`${t("admin.users.revokeSessions")}: ${email}`} description={t("admin.users.revokeSessionsHint")} path={`/api/v1/admin/users/${userId}/sessions`} method="DELETE" />
      <ActionDialog
        trigger={
          <Button size="sm" variant="danger">
            {t("admin.users.delete")}
          </Button>
        }
        title={`${t("admin.users.delete")}: ${email}`}
        description={t("admin.users.deleteHint")}
        confirmLabel={t("admin.users.delete")}
        phrase={email}
        danger
        onConfirm={async (reason, confirm) => {
          await api(`/api/v1/admin/users/${userId}`, { method: "DELETE", body: { reason, confirm } });
          router.push(`/${locale}/admin/users`);
          router.refresh();
        }}
      />
    </div>
  );
}

export function PlatformRoleGrant({ userId, roles }: { userId: string; roles: string[] }) {
  const { t } = useI18n();
  const run = useAdminAction();
  const [role, setRole] = useState(roles[0] ?? "");
  if (!roles.length) return null;
  return (
    <ActionDialog
      trigger={
        <Button size="sm" variant="secondary">
          {t("admin.users.grantRole")}
        </Button>
      }
      title={t("admin.users.grantRole")}
      description={t("admin.users.grantRoleHint")}
      confirmLabel={t("admin.users.grantRole")}
      onConfirm={(reason) => run(`/api/v1/admin/users/${userId}/roles`, "POST", { roleKey: role, reason })}
    >
      <Field label={t("admin.users.role")} htmlFor="role-key">
        <Select id="role-key" value={role} onChange={(e) => setRole(e.target.value)}>
          {roles.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </Select>
      </Field>
    </ActionDialog>
  );
}

export function PlatformRoleRevoke({ userId, assignmentId, roleKey }: { userId: string; assignmentId: string; roleKey: string }) {
  const { t } = useI18n();
  return (
    <ActionButton
      label={t("admin.users.revokeRole")}
      title={`${t("admin.users.revokeRole")}: ${roleKey}`}
      path={`/api/v1/admin/users/${userId}/roles/${assignmentId}`}
      method="DELETE"
      variant="ghost"
    />
  );
}
