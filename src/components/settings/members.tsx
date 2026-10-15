"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { FormError } from "@/components/form-error";
import { useI18n, useT } from "@/i18n/client";
import { api } from "@/lib/api-client";

export interface RoleOption {
  id: string;
  key: string;
  name: string;
  isSystem: boolean;
  assignableAt: string[];
}

export function InviteForm({ orgId, roles }: { orgId: string; roles: RoleOption[] }) {
  const t = useT();
  const router = useRouter();
  const orgRoles = roles.filter((r) => r.assignableAt.includes("ORGANIZATION"));
  const [email, setEmail] = useState("");
  const [roleId, setRoleId] = useState(orgRoles.find((r) => r.key === "MEMBER" || r.key === "VIEWER")?.id ?? orgRoles[0]?.id ?? "");
  const [error, setError] = useState<unknown>(null);
  const [sent, setSent] = useState<null | "SENT" | "FAILED" | "NOT_CONFIGURED">(null);
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="grid gap-3 sm:grid-cols-[1fr_200px_auto] sm:items-end"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        setSent(null);
        try {
          const r = await api<{ delivery: "SENT" | "FAILED" | "NOT_CONFIGURED" }>(`/api/v1/organizations/${orgId}/invitations`, {
            body: { email, roleId, scopeType: "ORGANIZATION" },
          });
          setSent(r.delivery);
          setEmail("");
          router.refresh();
        } catch (err) {
          setError(err);
        } finally {
          setBusy(false);
        }
      }}
    >
      <Field label={t("settings.members.inviteEmail")} htmlFor="invite-email">
        <Input id="invite-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </Field>
      <Field label={t("settings.members.role")} htmlFor="invite-role">
        <Select id="invite-role" value={roleId} onChange={(e) => setRoleId(e.target.value)}>
          {orgRoles.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </Select>
      </Field>
      <Button type="submit" disabled={busy || !email}>
        {t("settings.members.invite")}
      </Button>
      <div className="sm:col-span-3">
        <FormError error={error} />
        {sent === "SENT" ? <Notice tone="success">{t("settings.members.sentOk")}</Notice> : null}
        {sent === "FAILED" ? <Notice tone="danger">{t("settings.members.sentFailed")}</Notice> : null}
        {sent === "NOT_CONFIGURED" ? <Notice tone="warning">{t("settings.members.sent")}</Notice> : null}
      </div>
    </form>
  );
}

export function CustomRoleForm({ orgId, permissions }: { orgId: string; permissions: string[] }) {
  const t = useT();
  const router = useRouter();
  const [key, setKey] = useState("");
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const groups = Object.entries(
    permissions.reduce<Record<string, string[]>>((acc, p) => {
      const r = p.slice(0, p.lastIndexOf("."));
      (acc[r] ??= []).push(p);
      return acc;
    }, {}),
  );
  return (
    <form
      className="grid gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          await api(`/api/v1/organizations/${orgId}/roles`, { body: { key, name, permissions: selected } });
          setKey("");
          setName("");
          setSelected([]);
          router.refresh();
        } catch (err) {
          setError(err);
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("settings.members.roleName")} htmlFor="role-name">
          <Input id="role-name" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label={t("settings.members.roleKey")} htmlFor="role-key">
          <Input id="role-key" dir="ltr" className="font-mono" value={key} onChange={(e) => setKey(e.target.value.toLowerCase())} />
        </Field>
      </div>
      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-medium">{t("settings.members.permissions")}</legend>
        <div className="grid gap-x-6 gap-y-1 sm:grid-cols-3">
          {groups.map(([resource, perms]) => (
            <div key={resource} className="grid gap-0.5 py-1">
              <span className="font-mono text-[11px] text-muted-foreground">{resource}</span>
              {perms.map((p) => (
                <label key={p} className="flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={selected.includes(p)}
                    onChange={(e) => setSelected((s) => (e.target.checked ? [...s, p] : s.filter((x) => x !== p)))}
                  />
                  <span className="font-mono">{p.slice(p.lastIndexOf(".") + 1)}</span>
                </label>
              ))}
            </div>
          ))}
        </div>
      </fieldset>
      <FormError error={error} />
      <div>
        <Button type="submit" disabled={busy || !key || !name || selected.length === 0}>
          {t("common.create")}
        </Button>
      </div>
    </form>
  );
}

export interface PendingInvitation {
  id: string;
  email: string;
  roleName: string;
  expiresAt: string;
  deliveryStatus: "SENT" | "FAILED" | "NOT_CONFIGURED" | null;
}

export function PendingInvitations({ orgId, invitations, canManage }: { orgId: string; invitations: PendingInvitation[]; canManage: boolean }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const act = async (id: string, fn: () => Promise<unknown>) => {
    setBusy(id);
    setError(null);
    try {
      await fn();
      router.refresh();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="grid gap-2">
      <FormError error={error} />
      <ul className="divide-y">
        {invitations.map((inv) => (
          <li key={inv.id} className="flex flex-wrap items-center gap-2 px-4 py-2">
            <span className="font-medium">{inv.email}</span>
            <span className="text-xs text-muted-foreground">{inv.roleName}</span>
            <span className="text-xs text-muted-foreground">
              {t("settings.members.expires", { date: new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(inv.expiresAt)) })}
            </span>
            {inv.deliveryStatus ? (
              <span className={`text-xs ${inv.deliveryStatus === "SENT" ? "text-success" : "text-warning"}`}>{t(`settings.members.delivery.${inv.deliveryStatus}`)}</span>
            ) : null}
            {canManage ? (
              <span className="ms-auto flex gap-1">
                <Button size="sm" variant="ghost" disabled={busy === inv.id} onClick={() => act(inv.id, () => api(`/api/v1/organizations/${orgId}/invitations/${inv.id}/resend`, { method: "POST" }))}>
                  {t("settings.members.resend")}
                </Button>
                <Button size="sm" variant="ghost" disabled={busy === inv.id} onClick={() => act(inv.id, () => api(`/api/v1/organizations/${orgId}/invitations/${inv.id}`, { method: "DELETE" }))}>
                  {t("settings.members.revoke")}
                </Button>
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
