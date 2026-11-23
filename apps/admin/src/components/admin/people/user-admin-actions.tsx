"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { BadgeCheck, Download, KeyRound, LogOut, RotateCcw, ShieldOff, Trash2, UserCog, UserPlus, VenetianMask } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { useToast } from "@/components/ui/toast";
import { useI18n } from "@/i18n/client";
import { api } from "@/lib/api-client";
import { ActionDialog, useAdminAction } from "../action-dialog";

/**
 * Stream B user actions. Every one is confirmed, carries an audited reason, and is re-authorized by the backend
 * (platform.users.manage / platform.security.manage / platform.impersonate); destructive ones take a typed phrase.
 */

function MfaCodeField({ value, onChange, id }: { value: string; onChange: (v: string) => void; id: string }) {
  const { t } = useI18n();
  return (
    <Field label={t("admin.roles.mfaCode")} htmlFor={id} hint={t("admin.roles.mfaHint")}>
      <Input id={id} inputMode="numeric" autoComplete="one-time-code" value={value} onChange={(e) => onChange(e.target.value)} className="font-mono" maxLength={20} />
    </Field>
  );
}

export function VerifyEmailButton({ userId, email }: { userId: string; email: string }) {
  const { t } = useI18n();
  const run = useAdminAction({ success: t("admin.access.users.verifyDone") });
  return (
    <ActionDialog
      trigger={
        <Button size="sm" variant="secondary">
          <BadgeCheck />
          {t("admin.access.users.verifyEmail")}
        </Button>
      }
      title={`${t("admin.access.users.verifyEmail")}: ${email}`}
      description={t("admin.access.users.verifyEmailHint")}
      confirmLabel={t("admin.access.users.verifyEmail")}
      onConfirm={(reason) => run(`/api/v1/admin/users/${userId}/verify-email`, "POST", { reason })}
    />
  );
}

export function ForceLogoutButton({ userId, email, sessions }: { userId: string; email: string; sessions: number }) {
  const { t } = useI18n();
  const run = useAdminAction({ success: t("admin.access.users.logoutDone") });
  return (
    <ActionDialog
      trigger={
        <Button size="sm" variant="secondary">
          <LogOut />
          {t("admin.access.users.forceLogout")}
        </Button>
      }
      title={`${t("admin.access.users.forceLogout")}: ${email}`}
      description={t("admin.access.users.forceLogoutHint", { count: sessions })}
      confirmLabel={t("admin.access.users.forceLogout")}
      onConfirm={(reason) => run(`/api/v1/admin/users/${userId}/sessions`, "DELETE", { reason })}
    />
  );
}

export function RevokeSessionButton({ userId, sessionId, label }: { userId: string; sessionId: string; label: string }) {
  const { t } = useI18n();
  const run = useAdminAction({ success: t("admin.access.users.sessionRevoked") });
  return (
    <ActionDialog
      trigger={
        <Button size="sm" variant="ghost" aria-label={`${t("admin.access.users.revokeSession")}: ${label}`}>
          {t("admin.access.users.revokeSession")}
        </Button>
      }
      title={t("admin.access.users.revokeSession")}
      description={label}
      confirmLabel={t("admin.access.users.revokeSession")}
      onConfirm={(reason) => run(`/api/v1/admin/users/${userId}/sessions/${sessionId}`, "DELETE", { reason })}
    />
  );
}

export function ResetMfaButton({ userId, email }: { userId: string; email: string }) {
  const { t } = useI18n();
  const run = useAdminAction({ success: t("admin.access.users.mfaResetDone") });
  return (
    <ActionDialog
      trigger={
        <Button size="sm" variant="secondary">
          <ShieldOff />
          {t("admin.access.users.resetMfa")}
        </Button>
      }
      title={`${t("admin.access.users.resetMfa")}: ${email}`}
      description={t("admin.access.users.resetMfaHint")}
      confirmLabel={t("admin.access.users.resetMfa")}
      phrase={email}
      danger
      onConfirm={(reason, confirm) => run(`/api/v1/admin/users/${userId}/mfa-reset`, "POST", { reason, confirm })}
    />
  );
}

export function PasswordResetButton({ userId, email }: { userId: string; email: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const toast = useToast();
  return (
    <ActionDialog
      trigger={
        <Button size="sm" variant="secondary">
          <KeyRound />
          {t("admin.access.users.sendReset")}
        </Button>
      }
      title={`${t("admin.access.users.sendReset")}: ${email}`}
      description={t("admin.access.users.sendResetHint")}
      confirmLabel={t("admin.access.users.sendReset")}
      onConfirm={async (reason) => {
        const r = await api<{ emailDelivery: string }>(`/api/v1/admin/users/${userId}/password-reset`, { method: "POST", body: { reason } });
        if (r.emailDelivery === "configured") toast.success(t("admin.access.users.resetQueued"));
        else toast.error(t("admin.access.users.emailNotConfigured"));
        router.refresh();
      }}
    />
  );
}

export function DeleteUserButton({ userId, email, graceDefault }: { userId: string; email: string; graceDefault: number }) {
  const { t } = useI18n();
  const run = useAdminAction({ success: t("admin.access.users.deletionScheduled") });
  const [days, setDays] = useState(String(graceDefault));
  return (
    <ActionDialog
      trigger={
        <Button size="sm" variant="danger">
          <Trash2 />
          {t("admin.users.delete")}
        </Button>
      }
      title={`${t("admin.users.delete")}: ${email}`}
      description={t("admin.access.users.deleteGraceHint")}
      confirmLabel={t("admin.access.users.scheduleDeletion")}
      phrase={email}
      danger
      canSubmit={Number(days) >= 1 && Number(days) <= 90}
      onConfirm={(reason, confirm) => run(`/api/v1/admin/users/${userId}`, "DELETE", { reason, confirm, graceDays: Number(days) })}
    >
      <Field label={t("admin.access.users.graceDays")} htmlFor="grace-days" hint={t("admin.access.users.graceDaysHint")}>
        <Input id="grace-days" type="number" min={1} max={90} value={days} onChange={(e) => setDays(e.target.value)} className="w-28" />
      </Field>
    </ActionDialog>
  );
}

export function RestoreUserButton({ userId, email }: { userId: string; email: string }) {
  const { t } = useI18n();
  const run = useAdminAction({ success: t("admin.access.users.restored") });
  return (
    <ActionDialog
      trigger={
        <Button size="sm">
          <RotateCcw />
          {t("admin.access.users.restore")}
        </Button>
      }
      title={`${t("admin.access.users.restore")}: ${email}`}
      description={t("admin.access.users.restoreHint")}
      confirmLabel={t("admin.access.users.restore")}
      onConfirm={(reason) => run(`/api/v1/admin/users/${userId}/restore`, "POST", { reason })}
    />
  );
}

export function PurgeUserButton({ userId, email }: { userId: string; email: string }) {
  const { t } = useI18n();
  const run = useAdminAction({ success: t("admin.access.users.purged") });
  return (
    <ActionDialog
      trigger={
        <Button size="sm" variant="danger">
          {t("admin.access.users.purgeNow")}
        </Button>
      }
      title={`${t("admin.access.users.purgeNow")}: ${email}`}
      description={t("admin.access.users.purgeHint")}
      confirmLabel={t("admin.access.users.purgeNow")}
      phrase={email}
      danger
      onConfirm={(reason, confirm) => run(`/api/v1/admin/users/${userId}/purge`, "POST", { reason, confirm })}
    />
  );
}

export function RestrictionsEditor({ userId, value }: { userId: string; value: { readOnly: boolean; aiDisabled: boolean } }) {
  const { t } = useI18n();
  const run = useAdminAction({ success: t("admin.access.users.restrictionsSaved") });
  const [v, setV] = useState(value);
  const changed = v.readOnly !== value.readOnly || v.aiDisabled !== value.aiDisabled;
  return (
    <ActionDialog
      trigger={
        <Button size="sm" variant="secondary">
          <UserCog />
          {t("admin.access.users.editRestrictions")}
        </Button>
      }
      title={t("admin.access.users.restrictions")}
      description={t("admin.access.users.restrictionsHint")}
      confirmLabel={t("common.save")}
      canSubmit={changed}
      onConfirm={(reason) => run(`/api/v1/admin/users/${userId}/restrictions`, "PUT", { ...v, reason })}
    >
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-1" checked={v.readOnly} onChange={(e) => setV({ ...v, readOnly: e.target.checked })} />
        <span>
          <span className="font-medium">{t("admin.access.users.readOnly")}</span>
          <span className="block text-xs text-muted-foreground">{t("admin.access.users.readOnlyHint")}</span>
        </span>
      </label>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-1" checked={v.aiDisabled} onChange={(e) => setV({ ...v, aiDisabled: e.target.checked })} />
        <span>
          <span className="font-medium">{t("admin.access.users.aiDisabled")}</span>
          <span className="block text-xs text-muted-foreground">{t("admin.access.users.aiDisabledHint")}</span>
        </span>
      </label>
    </ActionDialog>
  );
}

const ORG_ROLES = ["MEMBER", "ORGANIZATION_ADMIN", "ORGANIZATION_OWNER"] as const;

export function AddMembershipButton({ userId }: { userId: string }) {
  const { t } = useI18n();
  const run = useAdminAction({ success: t("admin.access.users.membershipAdded") });
  const [org, setOrg] = useState("");
  const [role, setRole] = useState<(typeof ORG_ROLES)[number]>("MEMBER");
  return (
    <ActionDialog
      trigger={
        <Button size="sm" variant="secondary">
          <UserPlus />
          {t("admin.access.users.addMembership")}
        </Button>
      }
      title={t("admin.access.users.addMembership")}
      description={t("admin.access.users.addMembershipHint")}
      confirmLabel={t("admin.access.users.addMembership")}
      canSubmit={org.trim().length > 0}
      onConfirm={(reason) => run(`/api/v1/admin/users/${userId}/memberships`, "POST", { organization: org.trim(), roleKey: role, reason })}
    >
      <Field label={t("admin.access.users.orgIdOrSlug")} htmlFor="m-org">
        <Input id="m-org" value={org} onChange={(e) => setOrg(e.target.value)} className="font-mono" />
      </Field>
      <Field label={t("admin.people.orgRoles")} htmlFor="m-role">
        <Select id="m-role" value={role} onChange={(e) => setRole(e.target.value as (typeof ORG_ROLES)[number])}>
          {ORG_ROLES.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </Select>
      </Field>
    </ActionDialog>
  );
}

export function RemoveMembershipButton({ userId, organizationId, organizationName }: { userId: string; organizationId: string; organizationName: string }) {
  const { t } = useI18n();
  const run = useAdminAction({ success: t("admin.access.users.membershipRemoved") });
  return (
    <ActionDialog
      trigger={
        <Button size="sm" variant="ghost">
          {t("admin.people.removeMember")}
        </Button>
      }
      title={`${t("admin.people.removeMember")}: ${organizationName}`}
      description={t("admin.people.removeMemberHint")}
      confirmLabel={t("admin.people.removeMember")}
      danger
      onConfirm={(reason) => run(`/api/v1/admin/organizations/${organizationId}/members/${userId}`, "DELETE", { reason })}
    />
  );
}

/** Grant a platform role, optionally temporary (expiry), with an MFA re-check. */
export function GrantPlatformRoleButton({ userId, roles, maxDays }: { userId: string; roles: { key: string; name: string; custom: boolean }[]; maxDays: number }) {
  const { t } = useI18n();
  const run = useAdminAction({ success: t("admin.access.roles.granted") });
  const [role, setRole] = useState(roles[0]?.key ?? "");
  const [temporary, setTemporary] = useState(false);
  const [hours, setHours] = useState("24");
  const [code, setCode] = useState("");
  if (!roles.length) return null;
  const h = Number(hours);
  const okHours = !temporary || (h >= 1 && h <= maxDays * 24);
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
      canSubmit={!!role && okHours}
      onConfirm={async (reason) => {
        await run(`/api/v1/admin/users/${userId}/roles`, "POST", { roleKey: role, reason, mfaCode: code || undefined, ...(temporary ? { expiresAt: new Date(Date.now() + h * 3_600_000).toISOString() } : {}) });
        setCode("");
      }}
    >
      <Field label={t("admin.users.role")} htmlFor="g-role">
        <Select id="g-role" value={role} onChange={(e) => setRole(e.target.value)}>
          {roles.map((r) => (
            <option key={r.key} value={r.key}>
              {r.custom ? `${r.name} (${t("admin.access.roles.custom")})` : r.key}
            </option>
          ))}
        </Select>
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={temporary} onChange={(e) => setTemporary(e.target.checked)} />
        {t("admin.access.roles.temporary")}
      </label>
      {temporary ? (
        <Field label={t("admin.access.roles.durationHours")} htmlFor="g-hours" hint={t("admin.access.roles.durationHint", { days: maxDays })}>
          <Input id="g-hours" type="number" min={1} max={maxDays * 24} value={hours} onChange={(e) => setHours(e.target.value)} className="w-28" />
        </Field>
      ) : null}
      <MfaCodeField id="g-mfa" value={code} onChange={setCode} />
    </ActionDialog>
  );
}

export function RevokePlatformRoleButton({ userId, assignmentId, roleKey }: { userId: string; assignmentId: string; roleKey: string }) {
  const { t } = useI18n();
  const run = useAdminAction({ success: t("admin.access.roles.revoked") });
  const [code, setCode] = useState("");
  return (
    <ActionDialog
      trigger={
        <Button size="sm" variant="ghost">
          {t("admin.users.revokeRole")}
        </Button>
      }
      title={`${t("admin.users.revokeRole")}: ${roleKey}`}
      confirmLabel={t("admin.users.revokeRole")}
      danger
      onConfirm={async (reason) => {
        await run(`/api/v1/admin/users/${userId}/roles/${assignmentId}`, "DELETE", { reason, mfaCode: code || undefined });
        setCode("");
      }}
    >
      <MfaCodeField id="r-mfa" value={code} onChange={setCode} />
    </ActionDialog>
  );
}

/**
 * Start an audited impersonation. READ_ONLY by default; FULL (write) mode shows a second, explicit confirmation step
 * (the target's email typed). On success the one-time link opens the user app in a new tab.
 */
export function ImpersonateButton({ userId, email, organizations, locale }: { userId: string; email: string; organizations: { id: string; name: string }[]; locale: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const toast = useToast();
  const [minutes, setMinutes] = useState("30");
  const [mode, setMode] = useState<"READ_ONLY" | "FULL">("READ_ONLY");
  const [ticket, setTicket] = useState("");
  const [org, setOrg] = useState("");
  const [code, setCode] = useState("");
  const [writeAck, setWriteAck] = useState(false);
  const [writeEmail, setWriteEmail] = useState("");
  const [link, setLink] = useState<string | null>(null);
  const m = Number(minutes);
  const writeOk = mode === "READ_ONLY" || (writeAck && writeEmail.trim() === email);
  return (
    <>
      <ActionDialog
        trigger={
          <Button size="sm" variant="secondary">
            <VenetianMask />
            {t("admin.access.imp.start")}
          </Button>
        }
        title={`${t("admin.access.imp.start")}: ${email}`}
        description={t("admin.access.imp.startHint")}
        confirmLabel={mode === "FULL" ? t("admin.access.imp.startWrite") : t("admin.access.imp.startReadOnly")}
        danger={mode === "FULL"}
        canSubmit={m >= 5 && m <= 60 && writeOk}
        onConfirm={async (reason) => {
          const r = await api<{ url: string }>("/api/v1/admin/impersonation", {
            method: "POST",
            body: { userId, reason, minutes: m, mode, ticketRef: ticket.trim() || undefined, organizationId: org || undefined, locale, mfaCode: code || undefined, ...(mode === "FULL" ? { confirmWrite: writeEmail.trim() } : {}) },
          });
          setCode("");
          setLink(r.url);
          const w = window.open(r.url, "_blank", "noopener,noreferrer");
          if (!w) toast.error(t("admin.access.imp.popupBlocked"));
          else toast.success(t("admin.access.imp.started"));
          router.refresh();
        }}
      >
        <Notice tone="warning">{t("admin.access.imp.reasonMin")}</Notice>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("admin.access.imp.duration")} htmlFor="imp-min" hint={t("admin.access.imp.durationHint")}>
            <Input id="imp-min" type="number" min={5} max={60} value={minutes} onChange={(e) => setMinutes(e.target.value)} />
          </Field>
          <Field label={t("admin.access.imp.ticket")} htmlFor="imp-ticket">
            <Input id="imp-ticket" value={ticket} maxLength={120} onChange={(e) => setTicket(e.target.value)} />
          </Field>
        </div>
        {organizations.length ? (
          <Field label={t("admin.access.imp.organization")} htmlFor="imp-org">
            <Select id="imp-org" value={org} onChange={(e) => setOrg(e.target.value)}>
              <option value="">{t("admin.access.imp.anyOrganization")}</option>
              {organizations.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        <fieldset className="grid gap-2">
          <legend className="text-xs font-medium text-muted-foreground">{t("admin.access.imp.mode")}</legend>
          <label className="flex items-start gap-2 text-sm">
            <input type="radio" name="imp-mode" className="mt-1" checked={mode === "READ_ONLY"} onChange={() => setMode("READ_ONLY")} />
            <span>
              <span className="font-medium">{t("admin.access.imp.readOnly")}</span>
              <span className="block text-xs text-muted-foreground">{t("admin.access.imp.readOnlyHint")}</span>
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input type="radio" name="imp-mode" className="mt-1" checked={mode === "FULL"} onChange={() => setMode("FULL")} />
            <span>
              <span className="font-medium">{t("admin.access.imp.full")}</span>
              <span className="block text-xs text-muted-foreground">{t("admin.access.imp.fullHint")}</span>
            </span>
          </label>
        </fieldset>
        {mode === "FULL" ? (
          <div className="grid gap-2 rounded-md border border-danger/40 p-3">
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-1" checked={writeAck} onChange={(e) => setWriteAck(e.target.checked)} />
              {t("admin.access.imp.writeAck")}
            </label>
            <Field label={t("admin.common.typeToConfirm", { phrase: email })} htmlFor="imp-write">
              <Input id="imp-write" autoComplete="off" spellCheck={false} value={writeEmail} onChange={(e) => setWriteEmail(e.target.value)} className="font-mono" />
            </Field>
          </div>
        ) : null}
        <MfaCodeField id="imp-mfa" value={code} onChange={setCode} />
      </ActionDialog>
      {link ? (
        <a href={link} target="_blank" rel="noopener noreferrer" className="text-xs font-medium text-primary hover:underline">
          {t("admin.access.imp.openLink")}
        </a>
      ) : null}
    </>
  );
}

export function EndImpersonationButton({ impersonationId, own }: { impersonationId: string; own: boolean }) {
  const { t } = useI18n();
  const run = useAdminAction({ success: t("admin.access.imp.ended") });
  return (
    <ActionDialog
      trigger={
        <Button size="sm" variant="danger">
          {t("admin.access.imp.end")}
        </Button>
      }
      title={t("admin.access.imp.end")}
      description={own ? t("admin.access.imp.endOwnHint") : t("admin.access.imp.endOtherHint")}
      confirmLabel={t("admin.access.imp.end")}
      danger
      onConfirm={(reason) => run(`/api/v1/admin/impersonation/${impersonationId}`, "DELETE", { reason })}
    />
  );
}

/** Download a CSV of the current directory filters (server export: platform.data.export, audited). */
export function ExportUsersButton({ filters }: { filters: Record<string, string> }) {
  const { t } = useI18n();
  const toast = useToast();
  return (
    <ActionDialog
      trigger={
        <Button size="sm" variant="secondary">
          <Download />
          {t("admin.access.users.exportCsv")}
        </Button>
      }
      title={t("admin.access.users.exportCsv")}
      description={t("admin.access.users.exportHint")}
      confirmLabel={t("admin.access.users.exportCsv")}
      onConfirm={async (reason) => {
        await download("/api/v1/admin/users/export", { reason, filters }, `realy-users-${new Date().toISOString().slice(0, 10)}.csv`);
        toast.success(t("admin.access.users.exported"));
      }}
    />
  );
}

/** POST a JSON body and save the response as a file (export endpoints stream non-JSON bodies). */
export async function download(path: string, body: unknown, filename: string) {
  const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin" });
  if (!res.ok) {
    let message = res.statusText;
    try {
      message = ((await res.json()) as { error?: { message?: string } }).error?.message ?? message;
    } catch {
      /* not JSON */
    }
    throw new Error(message);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

