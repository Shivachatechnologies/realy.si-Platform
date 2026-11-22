"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Archive, ArchiveRestore, Copy, Download, Flame, ListChecks, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { useToast } from "@/components/ui/toast";
import { useI18n } from "@/i18n/client";
import { api } from "@/lib/api-client";
import { ActionDialog, useAdminAction } from "../action-dialog";
import { download } from "./user-admin-actions";

/** Stream B: custom platform roles, break-glass, access reviews and organization archive / export actions. */

export interface PermissionOption {
  key: string;
  description: string;
  mfa: boolean;
  group: string;
}

function MfaCodeField({ value, onChange, id }: { value: string; onChange: (v: string) => void; id: string }) {
  const { t } = useI18n();
  return (
    <Field label={t("admin.roles.mfaCode")} htmlFor={id} hint={t("admin.roles.mfaHint")}>
      <Input id={id} inputMode="numeric" autoComplete="one-time-code" value={value} onChange={(e) => onChange(e.target.value)} className="font-mono" maxLength={20} />
    </Field>
  );
}

function PermissionPicker({ options, value, onChange, held }: { options: PermissionOption[]; value: string[]; onChange: (v: string[]) => void; held: string[] }) {
  const { t } = useI18n();
  const groups = [...new Set(options.map((o) => o.group))];
  const set = new Set(value);
  return (
    <fieldset className="grid max-h-72 gap-3 overflow-y-auto rounded-md border p-3">
      <legend className="px-1 text-xs font-medium text-muted-foreground">{t("admin.access.roles.permissions", { count: value.length })}</legend>
      {groups.map((g) => (
        <div key={g} className="grid gap-1">
          <div className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{g}</div>
          {options
            .filter((o) => o.group === g)
            .map((o) => {
              const can = held.includes(o.key);
              return (
                <label key={o.key} className={`flex items-start gap-2 text-xs ${can ? "" : "opacity-50"}`} title={can ? o.description : t("admin.access.roles.notHeld")}>
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    disabled={!can}
                    checked={set.has(o.key)}
                    onChange={(e) => onChange(e.target.checked ? [...value, o.key] : value.filter((k) => k !== o.key))}
                  />
                  <span>
                    <span className="font-mono">{o.key}</span>
                    {o.mfa ? <span className="ms-1 rounded bg-warning/10 px-1 text-[10px] text-warning">MFA</span> : null}
                    <span className="block text-muted-foreground">{o.description}</span>
                  </span>
                </label>
              );
            })}
        </div>
      ))}
    </fieldset>
  );
}

export function CreateRoleButton({ options, held }: { options: PermissionOption[]; held: string[] }) {
  const { t } = useI18n();
  const run = useAdminAction({ success: t("admin.access.roles.created") });
  const [key, setKey] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [perms, setPerms] = useState<string[]>([]);
  const [code, setCode] = useState("");
  return (
    <ActionDialog
      trigger={
        <Button size="sm">
          <Plus />
          {t("admin.access.roles.create")}
        </Button>
      }
      title={t("admin.access.roles.create")}
      description={t("admin.access.roles.createHint")}
      confirmLabel={t("admin.access.roles.create")}
      canSubmit={/^[a-z][a-z0-9_-]{1,48}$/.test(key) && name.trim().length > 0 && perms.length > 0}
      onConfirm={async (reason) => {
        await run("/api/v1/admin/roles/custom", "POST", { key, name, description, permissions: perms, reason, mfaCode: code || undefined });
        setCode("");
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("admin.access.roles.key")} htmlFor="cr-key" hint={t("admin.access.roles.keyHint")}>
          <Input id="cr-key" value={key} onChange={(e) => setKey(e.target.value.toLowerCase())} className="font-mono" maxLength={49} />
        </Field>
        <Field label={t("admin.access.roles.name")} htmlFor="cr-name">
          <Input id="cr-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
        </Field>
      </div>
      <Field label={t("admin.access.roles.description")} htmlFor="cr-desc">
        <Textarea id="cr-desc" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} />
      </Field>
      <PermissionPicker options={options} value={perms} onChange={setPerms} held={held} />
      <MfaCodeField id="cr-mfa" value={code} onChange={setCode} />
    </ActionDialog>
  );
}

export function CloneRoleButton({ source, sourceName, locale }: { source: string; sourceName: string; locale: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const toast = useToast();
  const [key, setKey] = useState("");
  const [name, setName] = useState(`${sourceName} (copy)`);
  const [code, setCode] = useState("");
  return (
    <ActionDialog
      trigger={
        <Button size="sm" variant="ghost">
          <Copy />
          {t("admin.access.roles.clone")}
        </Button>
      }
      title={`${t("admin.access.roles.clone")}: ${sourceName}`}
      description={t("admin.access.roles.cloneHint")}
      confirmLabel={t("admin.access.roles.clone")}
      canSubmit={/^[a-z][a-z0-9_-]{1,48}$/.test(key) && name.trim().length > 0}
      onConfirm={async (reason) => {
        const r = await api<{ id: string }>("/api/v1/admin/roles/clone", { method: "POST", body: { source, key, name, reason, mfaCode: code || undefined } });
        setCode("");
        toast.success(t("admin.access.roles.created"));
        router.push(`/${locale}/roles/${r.id}`);
        router.refresh();
      }}
    >
      <Field label={t("admin.access.roles.key")} htmlFor="cl-key" hint={t("admin.access.roles.keyHint")}>
        <Input id="cl-key" value={key} onChange={(e) => setKey(e.target.value.toLowerCase())} className="font-mono" maxLength={49} />
      </Field>
      <Field label={t("admin.access.roles.name")} htmlFor="cl-name">
        <Input id="cl-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
      </Field>
      <MfaCodeField id="cl-mfa" value={code} onChange={setCode} />
    </ActionDialog>
  );
}

export function EditRoleButton({ roleId, initial, options, held }: { roleId: string; initial: { name: string; description: string; permissions: string[] }; options: PermissionOption[]; held: string[] }) {
  const { t } = useI18n();
  const run = useAdminAction({ success: t("admin.access.roles.saved") });
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description);
  const [perms, setPerms] = useState(initial.permissions);
  const [code, setCode] = useState("");
  const permsChanged = perms.length !== initial.permissions.length || perms.some((p) => !initial.permissions.includes(p));
  const changed = name !== initial.name || description !== initial.description || permsChanged;
  return (
    <ActionDialog
      trigger={
        <Button size="sm" variant="secondary">
          <Pencil />
          {t("admin.common.edit")}
        </Button>
      }
      title={t("admin.access.roles.edit")}
      description={t("admin.access.roles.editHint")}
      confirmLabel={t("common.save")}
      canSubmit={changed && perms.length > 0 && name.trim().length > 0}
      onConfirm={async (reason) => {
        await run(`/api/v1/admin/roles/custom/${roleId}`, "PATCH", { ...(name !== initial.name ? { name } : {}), ...(description !== initial.description ? { description } : {}), ...(permsChanged ? { permissions: perms } : {}), reason, mfaCode: code || undefined });
        setCode("");
      }}
    >
      <Field label={t("admin.access.roles.name")} htmlFor="er-name">
        <Input id="er-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
      </Field>
      <Field label={t("admin.access.roles.description")} htmlFor="er-desc">
        <Textarea id="er-desc" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} />
      </Field>
      <PermissionPicker options={options} value={perms} onChange={setPerms} held={[...new Set([...held, ...initial.permissions])]} />
      <MfaCodeField id="er-mfa" value={code} onChange={setCode} />
    </ActionDialog>
  );
}

export function DeleteRoleButton({ roleId, roleKey, holders, locale }: { roleId: string; roleKey: string; holders: number; locale: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const toast = useToast();
  const [code, setCode] = useState("");
  return (
    <ActionDialog
      trigger={
        <Button size="sm" variant="danger" disabled={holders > 0} title={holders > 0 ? t("admin.access.roles.deleteBlocked") : undefined}>
          <Trash2 />
          {t("admin.access.roles.delete")}
        </Button>
      }
      title={`${t("admin.access.roles.delete")}: ${roleKey}`}
      description={t("admin.access.roles.deleteHint")}
      confirmLabel={t("admin.access.roles.delete")}
      phrase={roleKey}
      danger
      onConfirm={async (reason, confirm) => {
        await api(`/api/v1/admin/roles/custom/${roleId}`, { method: "DELETE", body: { reason, confirm, mfaCode: code || undefined } });
        toast.success(t("admin.access.roles.deleted"));
        router.push(`/${locale}/roles`);
        router.refresh();
      }}
    >
      <MfaCodeField id="dr-mfa" value={code} onChange={setCode} />
    </ActionDialog>
  );
}

export function BreakGlassButton({ phrase, maxMinutes }: { phrase: string; maxMinutes: number }) {
  const { t } = useI18n();
  const run = useAdminAction({ success: t("admin.access.roles.breakGlassOn") });
  const [minutes, setMinutes] = useState("60");
  const [code, setCode] = useState("");
  const [reason, setReason] = useState("");
  const m = Number(minutes);
  return (
    <ActionDialog
      trigger={
        <Button size="sm" variant="danger">
          <Flame />
          {t("admin.access.roles.breakGlass")}
        </Button>
      }
      title={t("admin.access.roles.breakGlass")}
      description={t("admin.access.roles.breakGlassHint", { hours: maxMinutes / 60 })}
      confirmLabel={t("admin.access.roles.breakGlass")}
      phrase={phrase}
      danger
      canSubmit={m >= 15 && m <= maxMinutes && reason.trim().length >= 20}
      onConfirm={async (r, confirm) => {
        await run("/api/v1/admin/roles/break-glass", "POST", { minutes: m, reason: `${reason.trim()} — ${r}`.slice(0, 500), confirm, mfaCode: code || undefined });
        setCode("");
      }}
    >
      <Notice tone="danger">{t("admin.access.roles.breakGlassWarning")}</Notice>
      <Field label={t("admin.access.roles.emergency")} htmlFor="bg-why" hint={t("admin.access.roles.emergencyHint")}>
        <Textarea id="bg-why" value={reason} onChange={(e) => setReason(e.target.value)} minLength={20} maxLength={400} />
      </Field>
      <Field label={t("admin.access.roles.durationMinutes")} htmlFor="bg-min">
        <Input id="bg-min" type="number" min={15} max={maxMinutes} value={minutes} onChange={(e) => setMinutes(e.target.value)} className="w-28" />
      </Field>
      <MfaCodeField id="bg-mfa" value={code} onChange={setCode} />
    </ActionDialog>
  );
}

export function CreateReviewButton({ locale }: { locale: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const toast = useToast();
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  return (
    <ActionDialog
      trigger={
        <Button size="sm">
          <ListChecks />
          {t("admin.access.reviews.create")}
        </Button>
      }
      title={t("admin.access.reviews.create")}
      description={t("admin.access.reviews.createHint")}
      confirmLabel={t("admin.access.reviews.create")}
      canSubmit={title.trim().length >= 3}
      onConfirm={async (reason) => {
        const r = await api<{ id: string; items: number }>("/api/v1/admin/access-reviews", { method: "POST", body: { title, reason, ...(due ? { dueAt: new Date(due).toISOString() } : {}) } });
        toast.success(t("admin.access.reviews.created", { count: r.items }));
        router.push(`/${locale}/roles/reviews/${r.id}`);
        router.refresh();
      }}
    >
      <Field label={t("admin.access.reviews.title")} htmlFor="rv-title">
        <Input id="rv-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} />
      </Field>
      <Field label={t("admin.access.reviews.due")} htmlFor="rv-due">
        <Input id="rv-due" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
      </Field>
    </ActionDialog>
  );
}

export function DecideItem({ reviewId, itemId, who }: { reviewId: string; itemId: string; who: string }) {
  const { t } = useI18n();
  const run = useAdminAction();
  const [note, setNote] = useState("");
  const decide = (decision: "KEEP" | "REVOKE") => (
    <ActionDialog
      trigger={
        <Button size="sm" variant={decision === "KEEP" ? "secondary" : "danger"}>
          {t(`admin.access.reviews.${decision === "KEEP" ? "keep" : "revoke"}`)}
        </Button>
      }
      title={`${t(`admin.access.reviews.${decision === "KEEP" ? "keep" : "revoke"}`)}: ${who}`}
      description={decision === "REVOKE" ? t("admin.access.reviews.revokeHint") : t("admin.access.reviews.keepHint")}
      confirmLabel={t(`admin.access.reviews.${decision === "KEEP" ? "keep" : "revoke"}`)}
      danger={decision === "REVOKE"}
      onConfirm={(reason) => run(`/api/v1/admin/access-reviews/${reviewId}/items/${itemId}`, "POST", { decision, reason, note: note.trim() || undefined }, { success: t("admin.access.reviews.decided") })}
    >
      <Field label={t("admin.access.reviews.note")} htmlFor={`note-${itemId}-${decision}`}>
        <Input id={`note-${itemId}-${decision}`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
      </Field>
    </ActionDialog>
  );
  return (
    <span className="flex gap-1.5">
      {decide("KEEP")}
      {decide("REVOKE")}
    </span>
  );
}

export function CloseReviewButton({ reviewId, action, disabled }: { reviewId: string; action: "complete" | "cancel"; disabled?: boolean }) {
  const { t } = useI18n();
  const run = useAdminAction({ success: t(action === "complete" ? "admin.access.reviews.completed" : "admin.access.reviews.canceled") });
  return (
    <ActionDialog
      trigger={
        <Button size="sm" variant={action === "complete" ? "default" : "ghost"} disabled={disabled}>
          {t(action === "complete" ? "admin.access.reviews.complete" : "admin.access.reviews.cancel")}
        </Button>
      }
      title={t(action === "complete" ? "admin.access.reviews.complete" : "admin.access.reviews.cancel")}
      confirmLabel={t(action === "complete" ? "admin.access.reviews.complete" : "admin.access.reviews.cancel")}
      onConfirm={(reason) => run(`/api/v1/admin/access-reviews/${reviewId}`, "POST", { action, reason })}
    />
  );
}

export function ArchiveOrgButton({ organizationId, slug }: { organizationId: string; slug: string }) {
  const { t } = useI18n();
  const run = useAdminAction({ success: t("admin.access.org.archived") });
  return (
    <ActionDialog
      trigger={
        <Button size="sm" variant="danger">
          <Archive />
          {t("admin.access.org.archive")}
        </Button>
      }
      title={`${t("admin.access.org.archive")}: ${slug}`}
      description={t("admin.access.org.archiveHint")}
      confirmLabel={t("admin.access.org.archive")}
      phrase={slug}
      danger
      onConfirm={(reason, confirm) => run(`/api/v1/admin/organizations/${organizationId}/archive`, "POST", { reason, confirm })}
    />
  );
}

export function ReopenOrgButton({ organizationId, slug }: { organizationId: string; slug: string }) {
  const { t } = useI18n();
  const run = useAdminAction({ success: t("admin.access.org.reopened") });
  return (
    <ActionDialog
      trigger={
        <Button size="sm">
          <ArchiveRestore />
          {t("admin.access.org.reopen")}
        </Button>
      }
      title={`${t("admin.access.org.reopen")}: ${slug}`}
      description={t("admin.access.org.reopenHint")}
      confirmLabel={t("admin.access.org.reopen")}
      onConfirm={(reason) => run(`/api/v1/admin/organizations/${organizationId}/archive`, "DELETE", { reason })}
    />
  );
}

export function ExportCompanyButton({ organizationId, companies }: { organizationId: string; companies: { id: string; name: string }[] }) {
  const { t } = useI18n();
  const toast = useToast();
  const [company, setCompany] = useState(companies[0]?.id ?? "");
  if (!companies.length) return null;
  return (
    <ActionDialog
      trigger={
        <Button size="sm" variant="secondary">
          <Download />
          {t("admin.access.org.export")}
        </Button>
      }
      title={t("admin.access.org.export")}
      description={t("admin.access.org.exportHint")}
      confirmLabel={t("admin.access.org.export")}
      canSubmit={!!company}
      onConfirm={async (reason) => {
        await download(`/api/v1/admin/organizations/${organizationId}/export`, { companyId: company, reason }, `realy-company-${company}.json`);
        toast.success(t("admin.access.org.exported"));
      }}
    >
      <Field label={t("admin.people.company")} htmlFor="ex-company">
        <Select id="ex-company" value={company} onChange={(e) => setCompany(e.target.value)}>
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </Field>
    </ActionDialog>
  );
}
