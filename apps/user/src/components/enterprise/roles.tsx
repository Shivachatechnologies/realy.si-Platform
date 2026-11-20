"use client";

import { useMemo, useState } from "react";
import { Pencil, Plus, Trash2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { FormError } from "@/components/form-error";
import { useI18n } from "@/i18n/client";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { useAction } from "./use-action";

export interface PermissionGroup {
  area: string;
  permissions: { key: string; action: string; description: string }[];
}
export interface RoleRow {
  id: string;
  key: string;
  name: string;
  description: string;
  isSystem: boolean;
  assignableAt: string[];
  permissions: string[];
  assignments: number;
}

/** Permission matrix grouped by area; permissions the editor does not hold are locked (no escalation). */
export function PermissionMatrix({
  groups,
  held,
  value,
  onChange,
  lockedExtra = [],
}: {
  groups: PermissionGroup[];
  held: string[];
  value: string[];
  onChange: (v: string[]) => void;
  lockedExtra?: string[];
}) {
  const { t } = useI18n();
  const heldSet = useMemo(() => new Set([...held, ...lockedExtra]), [held, lockedExtra]);
  const selected = new Set(value);
  const toggle = (k: string) => onChange(selected.has(k) ? value.filter((x) => x !== k) : [...value, k]);
  return (
    <div className="grid gap-1 rounded-md border">
      <div className="grid grid-cols-[minmax(8rem,12rem)_1fr] gap-2 border-b bg-surface-2 px-3 py-1.5 text-xs font-medium text-muted-foreground">
        <span>{t("enterprise.roles.area")}</span>
        <span>{t("enterprise.roles.actions")}</span>
      </div>
      {groups.map((g) => {
        const grantable = g.permissions.filter((p) => heldSet.has(p.key) || selected.has(p.key));
        const all = grantable.length > 0 && grantable.every((p) => selected.has(p.key));
        return (
          <div key={g.area} className="grid grid-cols-[minmax(8rem,12rem)_1fr] items-center gap-2 px-3 py-1.5 text-sm">
            <label className="flex items-center gap-2 font-medium">
              <input
                type="checkbox"
                checked={all}
                disabled={!grantable.length}
                onChange={() =>
                  onChange(
                    all ? value.filter((v) => !grantable.some((p) => p.key === v)) : [...new Set([...value, ...grantable.filter((p) => heldSet.has(p.key)).map((p) => p.key)])],
                  )
                }
                aria-label={t("enterprise.roles.selectArea", {
                  area: t(`enterprise.areas.${g.area}`),
                })}
              />
              {t(`enterprise.areas.${g.area}`)}
            </label>
            <div className="flex flex-wrap gap-1.5">
              {g.permissions.map((p) => {
                const locked = !heldSet.has(p.key) && !selected.has(p.key);
                const on = selected.has(p.key);
                return (
                  <button
                    key={p.key}
                    type="button"
                    disabled={locked}
                    aria-pressed={on}
                    title={locked ? t("enterprise.roles.notHeld") : p.description}
                    onClick={() => toggle(p.key)}
                    className={cn(
                      "rounded-full border px-2 py-0.5 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-40",
                      on ? "border-primary bg-accent text-accent-foreground" : "hover:bg-muted",
                    )}
                  >
                    {t(`enterprise.actions.${p.action}`)}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function RoleEditor({ orgId, groups, held, role, onClose }: { orgId: string; groups: PermissionGroup[]; held: string[]; role?: RoleRow; onClose?: () => void }) {
  const { t } = useI18n();
  const [key, setKey] = useState(role?.key ?? "");
  const [name, setName] = useState(role?.name ?? "");
  const [description, setDescription] = useState(role?.description ?? "");
  const [perms, setPerms] = useState<string[]>(role?.permissions ?? []);
  const a = useAction();
  return (
    <form
      className="grid gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        void a.run(
          () =>
            role
              ? api(`/api/v1/organizations/${orgId}/enterprise/roles/${role.id}`, {
                  method: "PATCH",
                  body: { name, description, permissions: perms },
                })
              : api(`/api/v1/organizations/${orgId}/enterprise/roles`, {
                  body: { key, name, description, permissions: perms },
                }),
          () => {
            if (!role) {
              setKey("");
              setName("");
              setDescription("");
              setPerms([]);
            }
            onClose?.();
          },
        );
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("enterprise.roles.name")} htmlFor={`role-name-${role?.id ?? "new"}`} error={a.fields.name}>
          <Input id={`role-name-${role?.id ?? "new"}`} value={name} maxLength={80} required onChange={(e) => setName(e.target.value)} />
        </Field>
        {!role ? (
          <Field label={t("enterprise.roles.key")} htmlFor="role-key" hint={t("enterprise.roles.keyHint")} error={a.fields.key}>
            <Input id="role-key" dir="ltr" className="font-mono" value={key} maxLength={49} required onChange={(e) => setKey(e.target.value.toLowerCase())} />
          </Field>
        ) : (
          <div />
        )}
        <Field label={t("enterprise.roles.description")} htmlFor={`role-desc-${role?.id ?? "new"}`} className="sm:col-span-2">
          <Textarea id={`role-desc-${role?.id ?? "new"}`} rows={2} maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
      </div>
      <PermissionMatrix groups={groups} held={held} value={perms} onChange={setPerms} lockedExtra={role?.permissions} />
      <p className="text-xs text-muted-foreground">{t("enterprise.roles.selected", { count: perms.length })}</p>
      <FormError error={a.error} />
      <div className="flex gap-2">
        <Button type="submit" disabled={a.busy || !name || (!role && !key) || perms.length === 0}>
          {role ? (
            t("common.save")
          ) : (
            <>
              <Plus aria-hidden />
              {t("enterprise.roles.create")}
            </>
          )}
        </Button>
        {onClose ? (
          <Button type="button" variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
        ) : null}
      </div>
    </form>
  );
}

export function RoleList({ orgId, roles, groups, held, canManage }: { orgId: string; roles: RoleRow[]; groups: PermissionGroup[]; held: string[]; canManage: boolean }) {
  const { t } = useI18n();
  const [editing, setEditing] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const a = useAction();
  return (
    <ul className="divide-y">
      {roles.map((r) => (
        <li key={r.id} className="grid gap-2 px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="font-medium hover:underline" onClick={() => setOpen(open === r.id ? null : r.id)} aria-expanded={open === r.id}>
              {r.name}
            </button>
            <Badge>{r.isSystem ? t("settings.members.system") : t("settings.members.custom")}</Badge>
            <span className="font-mono text-xs text-muted-foreground">{r.key}</span>
            <span className="ms-auto text-xs text-muted-foreground">
              {t("settings.members.permissionCount", {
                count: r.permissions.length,
              })}{" "}
              · {t("enterprise.roles.assignedCount", { count: r.assignments })}
            </span>
            {canManage && !r.isSystem ? (
              <span className="flex gap-1">
                <Button size="icon" variant="ghost" className="size-8" aria-label={t("enterprise.roles.edit")} onClick={() => setEditing(editing === r.id ? null : r.id)}>
                  {editing === r.id ? <X aria-hidden /> : <Pencil aria-hidden />}
                </Button>
                {confirm === r.id ? (
                  <Button
                    size="sm"
                    variant="danger"
                    disabled={a.busy}
                    onClick={() =>
                      void a.run(
                        () => api(`/api/v1/organizations/${orgId}/enterprise/roles/${r.id}`, { method: "DELETE" }),
                        () => setConfirm(null),
                      )
                    }
                  >
                    {t("enterprise.roles.confirmDelete", {
                      count: r.assignments,
                    })}
                  </Button>
                ) : (
                  <Button size="icon" variant="ghost" className="size-8" aria-label={t("enterprise.roles.delete")} onClick={() => setConfirm(r.id)}>
                    <Trash2 aria-hidden />
                  </Button>
                )}
              </span>
            ) : null}
          </div>
          {r.description ? <p className="text-xs text-muted-foreground">{r.description}</p> : null}
          {open === r.id && editing !== r.id ? (
            <div className="flex flex-wrap gap-1">
              {r.permissions.map((p) => (
                <code key={p} className="rounded bg-muted px-1.5 py-0.5 text-[11px]">
                  {p}
                </code>
              ))}
            </div>
          ) : null}
          {editing === r.id ? <RoleEditor orgId={orgId} groups={groups} held={held} role={r} onClose={() => setEditing(null)} /> : null}
          {confirm === r.id ? <FormError error={a.error} /> : null}
        </li>
      ))}
    </ul>
  );
}

export interface MemberRow {
  userId: string;
  name: string;
  email: string;
  mfaEnabled: boolean;
}
export interface AssignmentRow {
  id: string;
  userId: string;
  roleId: string;
  roleName: string;
  scopeType: string;
  scopeId: string;
  expiresAt: string | null;
}

export function AssignRoles({
  orgId,
  members,
  roles,
  companies,
  assignments,
  canAssign,
}: {
  orgId: string;
  members: MemberRow[];
  roles: RoleRow[];
  companies: { id: string; name: string }[];
  assignments: AssignmentRow[];
  canAssign: boolean;
}) {
  const { t } = useI18n();
  const [userId, setUserId] = useState(members[0]?.userId ?? "");
  const [scope, setScope] = useState(`ORGANIZATION:${orgId}`);
  const [scopeType, scopeId] = scope.split(":") as [string, string];
  const eligible = roles.filter((r) => r.assignableAt.includes(scopeType));
  const [roleId, setRoleId] = useState("");
  const [expires, setExpires] = useState("");
  const a = useAction();
  const scopeName = (type: string, id: string) =>
    type === "ORGANIZATION" ? t("enterprise.roles.wholeOrg") : (companies.find((c) => c.id === id)?.name ?? `${type}:${id.slice(0, 8)}`);
  const effectiveRole = eligible.some((r) => r.id === roleId) ? roleId : (eligible[0]?.id ?? "");
  return (
    <div className="grid gap-4">
      <ul className="divide-y rounded-md border">
        {members.map((m) => {
          const mine = assignments.filter((x) => x.userId === m.userId);
          return (
            <li key={m.userId} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
              <span className="min-w-40 font-medium">
                {m.name}
                <span className="block text-xs font-normal text-muted-foreground">{m.email}</span>
              </span>
              <span className="flex flex-1 flex-wrap gap-1">
                {mine.length === 0 ? <span className="text-xs text-muted-foreground">{t("enterprise.roles.noRoles")}</span> : null}
                {mine.map((x) => (
                  <Badge key={x.id} tone="accent" className="gap-1.5">
                    {x.roleName} · {scopeName(x.scopeType, x.scopeId)}
                    {canAssign ? (
                      <button
                        type="button"
                        aria-label={t("enterprise.roles.revoke")}
                        disabled={a.busy}
                        onClick={() => void a.run(() => api(`/api/v1/organizations/${orgId}/role-assignments/${x.id}`, { method: "DELETE" }))}
                      >
                        <X className="size-3" aria-hidden />
                      </button>
                    ) : null}
                  </Badge>
                ))}
              </span>
              {!m.mfaEnabled ? <Badge tone="warning">{t("enterprise.roles.noMfa")}</Badge> : null}
            </li>
          );
        })}
      </ul>
      {canAssign ? (
        <form
          className="grid gap-3 sm:grid-cols-[1fr_1fr_1fr_10rem_auto] sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            void a.run(() =>
              api(`/api/v1/organizations/${orgId}/role-assignments`, {
                body: {
                  principalType: "USER",
                  principalId: userId,
                  roleId: effectiveRole,
                  scopeType,
                  scopeId,
                  expiresAt: expires ? new Date(`${expires}T23:59:59Z`).toISOString() : undefined,
                },
              }),
            );
          }}
        >
          <Field label={t("enterprise.roles.member")} htmlFor="as-user">
            <Select id="as-user" value={userId} onChange={(e) => setUserId(e.target.value)}>
              {members.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("enterprise.roles.scope")} htmlFor="as-scope">
            <Select id="as-scope" value={scope} onChange={(e) => setScope(e.target.value)}>
              <option value={`ORGANIZATION:${orgId}`}>{t("enterprise.roles.wholeOrg")}</option>
              {companies.map((c) => (
                <option key={c.id} value={`COMPANY:${c.id}`}>
                  {t("enterprise.roles.companyScope", { company: c.name })}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("enterprise.roles.role")} htmlFor="as-role">
            <Select id="as-role" value={effectiveRole} onChange={(e) => setRoleId(e.target.value)}>
              {eligible.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("enterprise.roles.expires")} htmlFor="as-exp">
            <Input id="as-exp" type="date" value={expires} onChange={(e) => setExpires(e.target.value)} />
          </Field>
          <Button type="submit" disabled={a.busy || !userId || !effectiveRole}>
            {t("enterprise.roles.assign")}
          </Button>
          <div className="sm:col-span-5">
            <FormError error={a.error} />
            <p className="text-xs text-muted-foreground">{t("enterprise.roles.mfaRule")}</p>
          </div>
        </form>
      ) : (
        <Notice tone="info">{t("enterprise.roles.cannotAssign")}</Notice>
      )}
    </div>
  );
}
