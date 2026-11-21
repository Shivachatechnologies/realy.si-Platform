import type { Metadata } from "next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { getLocale, getT } from "@/i18n/server";
import { db } from "@/server/core/db";
import { isAppError } from "@/server/core/errors";
import { accessMatrix, permissionGroups } from "@/server/modules/enterprise/roles";
import { requireOrgContext } from "@/server/workspace";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("enterprise.tabs.access") };
}

/** Who has what: members × permission areas, or the holders of one permission. */
export default async function AccessPage({ searchParams }: PageProps<"/[locale]/settings/access">) {
  const locale = await getLocale();
  const t = await getT(locale);
  const { viewer, org } = await requireOrgContext(locale);
  let rows: Awaited<ReturnType<typeof accessMatrix>>;
  try {
    rows = await accessMatrix(viewer.ctx, org.id);
  } catch (e) {
    if (isAppError(e) && ["forbidden", "mfa_required"].includes(e.code)) return <Notice tone="warning">{t(`errors.${e.code}`)}</Notice>;
    throw e;
  }
  const sp = await searchParams;
  const groups = permissionGroups();
  const all = groups.flatMap((g) => g.permissions.map((p) => p.key));
  const permission = typeof sp.permission === "string" && all.includes(sp.permission) ? sp.permission : "";
  const q = typeof sp.q === "string" ? sp.q.trim().toLowerCase().slice(0, 100) : "";
  const companies = new Map(
    (
      await db().company.findMany({
        where: { organizationId: org.id },
        select: { id: true, name: true },
      })
    ).map((c) => [c.id, c.name]),
  );
  const scopeName = (type: string, id: string) => (type === "ORGANIZATION" ? t("enterprise.roles.wholeOrg") : (companies.get(id) ?? `${type.toLowerCase()} ${id.slice(0, 8)}`));
  const visible = rows.filter((r) => (!q || r.name.toLowerCase().includes(q) || r.email.toLowerCase().includes(q)) && (!permission || r.permissions[permission]));

  return (
    <Card>
      <CardHeader title={t("enterprise.access.title")} description={t("enterprise.access.subtitle")} />
      <form className="grid gap-2 border-b p-3 sm:grid-cols-[minmax(0,1fr)_16rem_auto]" action={`/${locale}/settings/access`}>
        <Input name="q" type="search" defaultValue={q} placeholder={t("enterprise.access.searchMembers")} aria-label={t("enterprise.access.searchMembers")} />
        <Select name="permission" defaultValue={permission} aria-label={t("enterprise.access.permission")}>
          <option value="">{t("enterprise.access.anyPermission")}</option>
          {groups.map((g) => (
            <optgroup key={g.area} label={t(`enterprise.areas.${g.area}`)}>
              {g.permissions.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.key}
                </option>
              ))}
            </optgroup>
          ))}
        </Select>
        <Button type="submit" variant="secondary">
          {t("enterprise.access.filter")}
        </Button>
      </form>
      {visible.length === 0 ? (
        <p className="p-4 text-sm text-muted-foreground">{t("enterprise.access.nobody")}</p>
      ) : permission ? (
        <Table>
          <THead>
            <Tr>
              <Th>{t("enterprise.roles.member")}</Th>
              <Th>{t("enterprise.access.grantedBy")}</Th>
            </Tr>
          </THead>
          <TBody>
            {visible.map((r) => (
              <Tr key={r.userId}>
                <Td className="font-medium">
                  {r.name}
                  <div className="text-xs font-normal text-muted-foreground">{r.email}</div>
                </Td>
                <Td>
                  <div className="flex flex-wrap gap-1">
                    {r.permissions[permission]!.map((g, i) => (
                      <Badge key={i} tone="accent">
                        {g.role} · {scopeName(g.scopeType, g.scopeId)}
                      </Badge>
                    ))}
                  </div>
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      ) : (
        <Table>
          <THead>
            <Tr>
              <Th className="sticky start-0 bg-surface-2">{t("enterprise.roles.member")}</Th>
              {groups.map((g) => (
                <Th key={g.area}>{t(`enterprise.areas.${g.area}`)}</Th>
              ))}
            </Tr>
          </THead>
          <TBody>
            {visible.map((r) => (
              <Tr key={r.userId}>
                <Td className="sticky start-0 bg-surface font-medium whitespace-nowrap">
                  {r.name}
                  {!r.mfaEnabled ? (
                    <Badge tone="warning" className="ms-1">
                      {t("enterprise.roles.noMfa")}
                    </Badge>
                  ) : null}
                </Td>
                {groups.map((g) => {
                  const actions = g.permissions.filter((p) => r.permissions[p.key]).map((p) => p.action);
                  return (
                    <Td key={g.area} className="text-xs whitespace-nowrap">
                      {actions.length ? actions.map((a) => t(`enterprise.actions.${a}`)).join(", ") : <span className="text-muted-foreground">—</span>}
                    </Td>
                  );
                })}
              </Tr>
            ))}
          </TBody>
        </Table>
      )}
    </Card>
  );
}
