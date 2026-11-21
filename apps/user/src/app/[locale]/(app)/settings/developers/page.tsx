import type { Metadata } from "next";
import Link from "next/link";
import { CreateApiKey, RevokeKeyButton } from "@/components/enterprise/developers";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { getLocale, getT } from "@/i18n/server";
import { formatDate, formatRelativeTime } from "@/i18n/format";
import { isAppError } from "@/server/core/errors";
import { can, effectivePermissions } from "@/server/modules/rbac/service";
import { PLATFORM_ONLY } from "@/server/modules/rbac/catalog";
import { orgChain } from "@/server/modules/rbac/scope";
import { listApiKeys } from "@/server/modules/enterprise/api-keys";
import { getOrgLimits } from "@/server/modules/enterprise/policy";
import { permissionGroups } from "@/server/modules/enterprise/roles";
import { requestTime } from "@/server/session";
import { requireOrgContext } from "@/server/workspace";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("enterprise.tabs.developers") };
}

const TONE = {
  active: "success",
  revoked: "neutral",
  expired: "warning",
} as const;

export default async function DevelopersPage() {
  const locale = await getLocale();
  const t = await getT(locale);
  const { viewer, org } = await requireOrgContext(locale);
  const chain = orgChain(org.id);
  let keys: Awaited<ReturnType<typeof listApiKeys>>;
  try {
    keys = await listApiKeys(viewer.ctx, org.id);
  } catch (e) {
    if (isAppError(e) && ["forbidden", "mfa_required"].includes(e.code)) return <Notice tone="warning">{t(`errors.${e.code}`)}</Notice>;
    throw e;
  }
  const [canManage, held, limits] = await Promise.all([can(viewer.ctx, "developer.manage", chain), effectivePermissions(viewer.ctx, chain), getOrgLimits(org.id)]);
  const active = keys.filter((k) => k.status === "active").length;
  const now = requestTime();
  const tz = viewer.user.timezone;

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader
          title={t("enterprise.developers.title")}
          description={
            limits.maxApiKeys !== null
              ? t("enterprise.developers.limit", {
                  used: active,
                  limit: limits.maxApiKeys,
                })
              : t("enterprise.developers.subtitle")
          }
          actions={
            <Link href={`/${locale}/settings/developers/reference`} className="text-sm text-primary hover:underline">
              {t("enterprise.developers.reference")}
            </Link>
          }
        />
        {keys.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">{t("enterprise.developers.empty")}</p>
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>{t("enterprise.developers.keyName")}</Th>
                <Th>{t("enterprise.developers.prefix")}</Th>
                <Th>{t("enterprise.developers.scopes")}</Th>
                <Th>{t("enterprise.developers.lastUsed")}</Th>
                <Th>{t("enterprise.developers.expires")}</Th>
                <Th>{t("common.status")}</Th>
                <Th>
                  <span className="sr-only">{t("common.actions")}</span>
                </Th>
              </Tr>
            </THead>
            <TBody>
              {keys.map((k) => (
                <Tr key={k.id}>
                  <Td className="font-medium">
                    {k.name}
                    <div className="text-xs font-normal text-muted-foreground">
                      {t("enterprise.developers.createdBy", {
                        name: k.createdBy ?? "—",
                        date: formatDate(k.createdAt, locale, tz),
                      })}
                    </div>
                  </Td>
                  <Td className="font-mono text-xs" dir="ltr">
                    rly_{k.prefix}_…
                  </Td>
                  <Td className="max-w-64">
                    <details>
                      <summary className="cursor-pointer text-xs">
                        {t("settings.members.permissionCount", {
                          count: k.scopes.length,
                        })}
                      </summary>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {k.scopes.map((s) => (
                          <code key={s} className="rounded bg-muted px-1 text-[11px]">
                            {s}
                          </code>
                        ))}
                      </div>
                    </details>
                  </Td>
                  <Td className="whitespace-nowrap text-xs text-muted-foreground">
                    {k.lastUsedAt ? formatRelativeTime(k.lastUsedAt, locale, now) : t("enterprise.developers.neverUsed")}
                  </Td>
                  <Td className="whitespace-nowrap text-xs text-muted-foreground">{k.expiresAt ? formatDate(k.expiresAt, locale, tz) : t("enterprise.developers.never")}</Td>
                  <Td>
                    <Badge tone={TONE[k.status]}>{t(`enterprise.developers.statuses.${k.status}`)}</Badge>
                  </Td>
                  <Td>{canManage && k.status === "active" ? <RevokeKeyButton orgId={org.id} keyId={k.id} /> : null}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
      {canManage ? (
        <Card>
          <CardHeader title={t("enterprise.developers.newKey")} description={t("enterprise.developers.newKeyHint")} />
          <CardBody>
            <CreateApiKey orgId={org.id} groups={permissionGroups()} held={held.filter((p) => !PLATFORM_ONLY.has(p))} />
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
