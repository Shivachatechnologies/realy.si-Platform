import Link from "next/link";
import { Check, Grid3x3 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { AdminHeader, EmptyState, guard, sp } from "@/components/admin/kit";
import { getLocale, getT } from "@/i18n/server";
import { db } from "@/server/core/db";
import { isUuid } from "@/server/modules/admin/access";
import { diffPermissions, effectivePlatformPermissions, permissionMatrix } from "@/server/modules/admin/roles";
import { requireViewer } from "@/server/session";

/** Roles × platform permissions grid, the diff between two roles, and one admin's effective permissions. */
export default async function AdminRoleMatrixPage({ searchParams }: PageProps<"/[locale]/roles/matrix">) {
  const locale = await getLocale();
  const t = await getT(locale);
  const viewer = await requireViewer(locale);
  const q = await searchParams;
  const r = await guard(permissionMatrix(viewer.ctx), t("errors.forbidden"));
  if (!r.ok) return r.node;
  const { roles, permissions } = r.value;
  const a = roles.find((x) => x.key === sp(q.a)) ?? null;
  const b = roles.find((x) => x.key === sp(q.b)) ?? null;
  const diff = a && b ? diffPermissions(a.permissions, b.permissions) : null;
  const who = sp(q.user);
  const subject = who ? await db().user.findFirst({ where: isUuid(who) ? { id: who } : { email: who.toLowerCase() }, select: { id: true, name: true, email: true } }) : null;
  const effective = subject ? await effectivePlatformPermissions(viewer.ctx, subject.id) : null;
  const base = `/${locale}/roles/matrix`;
  return (
    <div className="grid gap-4">
      <AdminHeader icon={<Grid3x3 />} title={t("admin.access.matrix.title")} description={t("admin.access.matrix.subtitle")} />
      <Card>
        <CardHeader title={t("admin.access.matrix.grid")} description={t("admin.access.matrix.gridHint")} />
        <Table density="compact" stickyHeader maxHeight="70vh">
          <THead>
            <Tr>
              <Th className="sticky start-0 z-10 bg-surface-2">{t("admin.access.matrix.permission")}</Th>
              {roles.map((role) => (
                <Th key={role.key} className="text-center">
                  <Link href={`/${locale}/roles/${role.id ?? role.key}`} className="font-mono text-[10px] hover:underline" title={role.name}>
                    {role.key}
                  </Link>
                </Th>
              ))}
            </Tr>
          </THead>
          <TBody>
            {permissions.map((p) => (
              <Tr key={p.key}>
                <Td className="sticky start-0 bg-surface" title={p.description}>
                  <span className="font-mono text-[11px]">{p.key}</span>
                  {p.mfa ? (
                    <Badge tone="warning" className="ms-1">
                      MFA
                    </Badge>
                  ) : null}
                </Td>
                {roles.map((role) => (
                  <Td key={role.key} className="text-center">
                    {role.permissions.includes(p.key) ? <Check className="mx-auto size-3.5 text-success" aria-label={t("admin.access.common.yes")} /> : <span className="text-muted-foreground/40">·</span>}
                  </Td>
                ))}
              </Tr>
            ))}
          </TBody>
        </Table>
      </Card>
      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title={t("admin.access.matrix.diff")} description={t("admin.access.matrix.diffHint")} />
          <CardBody className="grid gap-3">
            <form action={base} className="flex flex-wrap items-end gap-2">
              {who ? <input type="hidden" name="user" value={who} /> : null}
              {(["a", "b"] as const).map((k) => (
                <Select key={k} name={k} defaultValue={sp(q[k]) ?? ""} aria-label={k.toUpperCase()} className="w-auto">
                  <option value="">{k.toUpperCase()}</option>
                  {roles.map((role) => (
                    <option key={role.key} value={role.key}>
                      {role.key}
                    </option>
                  ))}
                </Select>
              ))}
              <Button type="submit" variant="secondary" size="sm">
                {t("admin.access.matrix.compare")}
              </Button>
            </form>
            {diff && a && b ? (
              <div className="grid gap-2 text-xs">
                <div>
                  <span className="font-medium">{t("admin.access.matrix.onlyIn", { role: a.key })}</span> <span className="font-mono text-danger">{diff.onlyA.join(", ") || "—"}</span>
                </div>
                <div>
                  <span className="font-medium">{t("admin.access.matrix.onlyIn", { role: b.key })}</span> <span className="font-mono text-success">{diff.onlyB.join(", ") || "—"}</span>
                </div>
                <div>
                  <span className="font-medium">{t("admin.access.matrix.both")}</span> <span className="font-mono text-muted-foreground">{diff.both.length}</span>
                </div>
              </div>
            ) : null}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title={t("admin.access.matrix.effective")} description={t("admin.access.matrix.effectiveHint")} />
          <CardBody className="grid gap-3">
            <form action={base} className="flex flex-wrap items-end gap-2">
              {sp(q.a) ? <input type="hidden" name="a" value={sp(q.a)} /> : null}
              {sp(q.b) ? <input type="hidden" name="b" value={sp(q.b)} /> : null}
              <Input name="user" defaultValue={who} placeholder={t("admin.access.matrix.userPlaceholder")} className="w-72" maxLength={254} />
              <Button type="submit" variant="secondary" size="sm">
                {t("admin.access.matrix.show")}
              </Button>
            </form>
            {who && !subject ? <EmptyState title={t("common.noResults")} /> : null}
            {subject && effective ? (
              effective.length === 0 ? (
                <EmptyState title={t("admin.access.matrix.noPlatformAccess", { who: subject.email })} />
              ) : (
                <ul className="divide-y text-xs">
                  {effective.map((e) => (
                    <li key={e.key} className="flex items-center justify-between gap-2 py-1">
                      <span className="font-mono">{e.key}</span>
                      <span className="flex items-center gap-1">
                        {e.mfa ? <Badge tone="warning">MFA</Badge> : null}
                        {e.via.map((v) => (
                          <Badge key={v} tone="accent" className="font-mono">
                            {v}
                          </Badge>
                        ))}
                      </span>
                    </li>
                  ))}
                </ul>
              )
            ) : null}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
