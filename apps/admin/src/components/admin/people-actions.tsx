"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Pencil, Pin, Plus, RotateCcw, Trash2, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select, Textarea } from "@/components/ui/input";
import { FormError } from "@/components/form-error";
import { useI18n } from "@/i18n/client";
import { api } from "@/lib/api-client";
import { ActionDialog, useAdminAction } from "./action-dialog";

const LOCALES = ["en-US", "de-DE", "ar-AE", "hi-IN", "zh-CN"] as const;

export function EditUserProfile({ userId, initial }: { userId: string; initial: { name: string; email: string; locale: string; timezone: string } }) {
  const { t } = useI18n();
  const run = useAdminAction();
  const [v, setV] = useState(initial);
  const changed = Object.fromEntries(Object.entries(v).filter(([k, x]) => x !== initial[k as keyof typeof initial]));
  return (
    <ActionDialog
      trigger={
        <Button size="sm" variant="secondary">
          <Pencil />
          {t("admin.people.editProfile")}
        </Button>
      }
      title={t("admin.people.editProfile")}
      description={t("admin.people.editProfileHint")}
      confirmLabel={t("common.save")}
      canSubmit={Object.keys(changed).length > 0}
      onConfirm={(reason) => run(`/api/v1/admin/users/${userId}/profile`, "PUT", { ...changed, reason })}
    >
      <Field label={t("admin.people.name")} htmlFor="up-name">
        <Input id="up-name" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />
      </Field>
      <Field label={t("admin.people.email")} htmlFor="up-email" hint={t("admin.people.emailHint")}>
        <Input id="up-email" type="email" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("admin.people.locale")} htmlFor="up-locale">
          <Select id="up-locale" value={v.locale} onChange={(e) => setV({ ...v, locale: e.target.value })}>
            {LOCALES.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("admin.people.timezone")} htmlFor="up-tz">
          <Input id="up-tz" value={v.timezone} onChange={(e) => setV({ ...v, timezone: e.target.value })} />
        </Field>
      </div>
    </ActionDialog>
  );
}

export function ResetAccess({ userId, email }: { userId: string; email: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const [mfa, setMfa] = useState(true);
  const [pw, setPw] = useState(true);
  const [result, setResult] = useState<string | null>(null);
  return (
    <>
      <ActionDialog
        trigger={
          <Button size="sm" variant="secondary">
            <RotateCcw />
            {t("admin.people.resetAccess")}
          </Button>
        }
        title={t("admin.people.resetAccess")}
        description={t("admin.people.resetAccessHint", { email })}
        confirmLabel={t("admin.people.resetAccess")}
        phrase={email}
        danger
        onConfirm={async (reason) => {
          const r = await api<{ revokedSessions: number; emailDelivery: string | null }>(`/api/v1/admin/users/${userId}/reset-access`, { method: "POST", body: { reason, resetMfa: mfa, sendPasswordReset: pw } });
          setResult(t("admin.people.resetDone", { sessions: r.revokedSessions, email: r.emailDelivery ?? "—" }));
          router.refresh();
        }}
      >
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={pw} onChange={(e) => setPw(e.target.checked)} />
          {t("admin.people.sendReset")}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={mfa} onChange={(e) => setMfa(e.target.checked)} />
          {t("admin.people.requireMfa")}
        </label>
      </ActionDialog>
      {result ? <span className="text-xs text-success">{result}</span> : null}
    </>
  );
}

export function NotesPanel({ target, targetId, notes, canWrite }: { target: "user" | "organization"; targetId: string; notes: { id: string; body: string; pinned: boolean; author: string; createdAt: string }[]; canWrite: boolean }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [body, setBody] = useState("");
  const [pinned, setPinned] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="grid gap-3 p-3">
      {canWrite ? (
        <form
          className="grid gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError(null);
            try {
              await api("/api/v1/admin/notes", { method: "POST", body: { target, targetId, body, pinned } });
              setBody("");
              setPinned(false);
              router.refresh();
            } catch (err) {
              setError(err);
            } finally {
              setBusy(false);
            }
          }}
        >
          <Textarea aria-label={t("admin.people.noteBody")} placeholder={t("admin.people.notePlaceholder")} rows={2} maxLength={4000} value={body} onChange={(e) => setBody(e.target.value)} />
          <div className="flex items-center justify-between gap-2">
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} />
              {t("admin.people.pin")}
            </label>
            <Button size="sm" type="submit" disabled={busy || !body.trim()}>
              <Plus />
              {t("admin.people.addNote")}
            </Button>
          </div>
          <FormError error={error} />
        </form>
      ) : null}
      {notes.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t("admin.people.noNotes")}</p>
      ) : (
        <ul className="grid gap-2">
          {notes.map((n) => (
            <li key={n.id} className="rounded-md border bg-surface-2 p-2.5 text-sm">
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                {n.pinned ? <Pin className="size-3 text-primary" aria-label={t("admin.people.pinned")} /> : null}
                <span className="font-medium text-foreground">{n.author}</span>
                <span>{new Date(n.createdAt).toLocaleString(locale)}</span>
                {canWrite ? (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="ms-auto size-6"
                    aria-label={t("admin.people.deleteNote")}
                    onClick={async () => {
                      if (!window.confirm(t("admin.people.deleteNoteConfirm"))) return;
                      await api(`/api/v1/admin/notes/${n.id}`, { method: "DELETE" });
                      router.refresh();
                    }}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                ) : null}
              </div>
              <p className="mt-1 whitespace-pre-wrap">{n.body}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ───────────── Organizations ─────────────

export function CreateOrganization() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [name, setName] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [defaultLocale, setDefaultLocale] = useState("en-US");
  return (
    <ActionDialog
      trigger={
        <Button size="sm">
          <Plus />
          {t("admin.people.createOrg")}
        </Button>
      }
      title={t("admin.people.createOrg")}
      description={t("admin.people.createOrgHint")}
      confirmLabel={t("admin.people.create")}
      canSubmit={!!name.trim() && /.+@.+\..+/.test(ownerEmail)}
      onConfirm={async (reason) => {
        const r = await api<{ id: string }>("/api/v1/admin/organizations", { method: "POST", body: { name, ownerEmail, defaultLocale, reason } });
        router.push(`/${locale}/organizations/${r.id}`);
      }}
    >
      <Field label={t("admin.people.orgName")} htmlFor="co-name">
        <Input id="co-name" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label={t("admin.people.ownerEmail")} htmlFor="co-owner" hint={t("admin.people.ownerHint")}>
        <Input id="co-owner" type="email" value={ownerEmail} onChange={(e) => setOwnerEmail(e.target.value)} />
      </Field>
      <Field label={t("admin.people.locale")} htmlFor="co-locale">
        <Select id="co-locale" value={defaultLocale} onChange={(e) => setDefaultLocale(e.target.value)}>
          {LOCALES.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </Select>
      </Field>
    </ActionDialog>
  );
}

export function EditOrganization({ organizationId, initial }: { organizationId: string; initial: { name: string; slug: string; defaultLocale: string } }) {
  const { t } = useI18n();
  const run = useAdminAction();
  const [v, setV] = useState(initial);
  const changed = Object.fromEntries(Object.entries(v).filter(([k, x]) => x !== initial[k as keyof typeof initial]));
  return (
    <ActionDialog
      trigger={
        <Button size="sm" variant="secondary">
          <Pencil />
          {t("admin.people.editOrg")}
        </Button>
      }
      title={t("admin.people.editOrg")}
      confirmLabel={t("common.save")}
      canSubmit={Object.keys(changed).length > 0}
      onConfirm={(reason) => run(`/api/v1/admin/organizations/${organizationId}`, "PUT", { ...changed, reason })}
    >
      <Field label={t("admin.people.orgName")} htmlFor="eo-name">
        <Input id="eo-name" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />
      </Field>
      <Field label={t("admin.people.slug")} htmlFor="eo-slug" hint={t("admin.people.slugHint")}>
        <Input id="eo-slug" className="font-mono" value={v.slug} onChange={(e) => setV({ ...v, slug: e.target.value.toLowerCase() })} />
      </Field>
      <Field label={t("admin.people.locale")} htmlFor="eo-locale">
        <Select id="eo-locale" value={v.defaultLocale} onChange={(e) => setV({ ...v, defaultLocale: e.target.value })}>
          {LOCALES.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </Select>
      </Field>
    </ActionDialog>
  );
}

const ORG_ROLES = ["ORGANIZATION_OWNER", "ORGANIZATION_ADMIN", "MEMBER"] as const;

export function AddMember({ organizationId }: { organizationId: string }) {
  const { t } = useI18n();
  const run = useAdminAction();
  const [email, setEmail] = useState("");
  const [roleKey, setRoleKey] = useState<(typeof ORG_ROLES)[number]>("MEMBER");
  return (
    <ActionDialog
      trigger={
        <Button size="sm">
          <UserPlus />
          {t("admin.people.addMember")}
        </Button>
      }
      title={t("admin.people.addMember")}
      description={t("admin.people.addMemberHint")}
      confirmLabel={t("admin.people.addMember")}
      canSubmit={/.+@.+\..+/.test(email)}
      onConfirm={(reason) => run(`/api/v1/admin/organizations/${organizationId}/members`, "POST", { email, roleKey, reason })}
    >
      <Field label={t("admin.people.email")} htmlFor="am-email">
        <Input id="am-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </Field>
      <Field label={t("admin.roles.role")} htmlFor="am-role">
        <Select id="am-role" value={roleKey} onChange={(e) => setRoleKey(e.target.value as (typeof ORG_ROLES)[number])}>
          {ORG_ROLES.map((r) => (
            <option key={r} value={r}>
              {t(`admin.people.orgRoles.${r}`)}
            </option>
          ))}
        </Select>
      </Field>
    </ActionDialog>
  );
}

export function MemberRole({ organizationId, userId, name, current }: { organizationId: string; userId: string; name: string; current: string | null }) {
  const { t } = useI18n();
  const run = useAdminAction();
  const [roleKey, setRoleKey] = useState<string>(current && (ORG_ROLES as readonly string[]).includes(current) ? current : "MEMBER");
  return (
    <span className="inline-flex gap-1">
      <ActionDialog
        trigger={
          <Button size="sm" variant="ghost">
            {t("admin.people.changeRole")}
          </Button>
        }
        title={t("admin.people.changeRoleTitle", { name })}
        confirmLabel={t("common.save")}
        canSubmit={roleKey !== current}
        onConfirm={(reason) => run(`/api/v1/admin/organizations/${organizationId}/members/${userId}`, "PUT", { roleKey, reason })}
      >
        <Field label={t("admin.roles.role")} htmlFor={`mr-${userId}`}>
          <Select id={`mr-${userId}`} value={roleKey} onChange={(e) => setRoleKey(e.target.value)}>
            {ORG_ROLES.map((r) => (
              <option key={r} value={r}>
                {t(`admin.people.orgRoles.${r}`)}
              </option>
            ))}
          </Select>
        </Field>
      </ActionDialog>
      <ActionDialog
        trigger={
          <Button size="sm" variant="ghost" className="text-danger">
            {t("admin.people.removeMember")}
          </Button>
        }
        title={t("admin.people.removeMemberTitle", { name })}
        description={t("admin.people.removeMemberHint")}
        confirmLabel={t("admin.people.removeMember")}
        danger
        onConfirm={(reason) => run(`/api/v1/admin/organizations/${organizationId}/members/${userId}`, "DELETE", { reason })}
      />
    </span>
  );
}
