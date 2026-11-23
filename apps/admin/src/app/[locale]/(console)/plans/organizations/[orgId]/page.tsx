import Link from "next/link";
import { Layers } from "lucide-react";
import { AdminHeader, SectionLink, guard } from "@/components/admin/kit";
import { GrantAddonButton, GrantOverrideButton, RevokeOverrideButton, UnlockAllButton } from "@/components/admin/plans/plan-manager";
import { CreditAdjustButton } from "@/components/admin/billing/actions";
import { LEDGER_METERS } from "@/server/modules/entitlements/ledger";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { getLocale, getT } from "@/i18n/server";
import { formatDate, formatNumber } from "@/i18n/format";
import { canPlatform } from "@/server/modules/admin/access";
import { organizationEntitlements } from "@/server/modules/entitlements/admin";
import { requireViewer } from "@/server/session";

/** One organization's effective plan, usage of every limit, overrides, add-on grants and subscription actions. */
export default async function OrgEntitlementsPage({ params }: PageProps<"/[locale]/plans/organizations/[orgId]">) {
  const locale = await getLocale();
  const t = await getT(locale);
  const viewer = await requireViewer(locale);
  const { orgId } = await params;
  const res = await guard(organizationEntitlements(viewer.ctx, orgId), t("errors.forbidden"));
  if (!res.ok) return res.node;
  const { org, summary, overrides, addons } = res.value;
  const ent = summary.entitlements;
  const [canManage, canSubs] = await Promise.all([canPlatform(viewer.ctx, "pricing.manage"), canPlatform(viewer.ctx, "platform.subscriptions.manage")]);
  const manage = canManage || canSubs;
  const tz = viewer.user.timezone;
  const fmt = (v: number | null) => (v === null ? "∞" : formatNumber(v, locale, { maximumFractionDigits: 1 }));

  return (
    <div className="grid gap-4">
      <AdminHeader
        icon={<Layers />}
        eyebrow={<Link href={`/${locale}/plans`} className="hover:underline">{t("admin.plans.manager.title")}</Link>}
        title={org.name}
        description={`${ent.planName} · ${t(`admin.plans.manager.states.${ent.state}`)}${ent.enforced ? "" : ` · ${t("admin.plans.manager.notEnforced")}`}`}
        actions={
          manage ? (
            <div className="flex flex-wrap gap-2">
              <GrantAddonButton organizationId={org.id} />
              <GrantOverrideButton organizationId={org.id} />
              <UnlockAllButton organizationId={org.id} orgSlug={org.slug} />
              {canSubs ? <CreditAdjustButton organizationId={org.id} meters={[...LEDGER_METERS]} /> : null}
            </div>
          ) : null
        }
      />

      <Card>
        <CardHeader title={t("admin.plans.manager.subscription")} description={ent.subscription ? `${ent.subscription.planName} · ${ent.subscription.status} · ${ent.subscription.interval}${ent.subscription.currentPeriodEnd ? ` · ${formatDate(ent.subscription.currentPeriodEnd, locale, tz)}` : ""}` : ent.trialEndsAt ? t("admin.plans.manager.trialUntil", { date: formatDate(ent.trialEndsAt, locale, tz) }) : undefined} />
        <CardBody className="flex flex-wrap gap-3">
          {ent.subscription ? <SectionLink href={`/${locale}/subscriptions/${ent.subscription.id}`}>{t("admin.subscriptions.detail.manage")}</SectionLink> : <p className="text-sm text-muted-foreground">{t("admin.plans.manager.noSubscription")}</p>}
          <SectionLink href={`/${locale}/credits?org=${org.id}`}>{t("admin.credits.open")}</SectionLink>
          <SectionLink href={`/${locale}/invoices?org=${org.id}`}>{t("admin.invoices.title")}</SectionLink>
          <SectionLink href={`/${locale}/payments?org=${org.id}`}>{t("admin.payments.title")}</SectionLink>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("admin.plans.manager.usage")} description={`${formatDate(ent.window.start, locale, tz)} – ${formatDate(ent.window.end, locale, tz)}`} />
        <Table>
          <THead>
            <Tr>
              <Th>{t("admin.plans.manager.limit")}</Th>
              <Th>{t("admin.plans.manager.used")}</Th>
              <Th>{t("admin.plans.manager.planLimit")}</Th>
              <Th>{t("admin.plans.manager.addon")}</Th>
              <Th>{t("admin.plans.manager.effective")}</Th>
            </Tr>
          </THead>
          <TBody>
            {summary.rows.map((r) => (
              <Tr key={r.key}>
                <Td className="font-mono text-xs">{r.key}</Td>
                <Td className="tabular">{fmt(r.used)}</Td>
                <Td className="tabular">{fmt(r.planLimit)}</Td>
                <Td className="tabular">
                  {r.addon ? `+${fmt(r.addon)}` : "—"}
                  {r.ledger ? <div className="text-[11px] text-muted-foreground">{t("admin.credits.ledgerChange", { value: `${r.ledger > 0 ? "+" : ""}${fmt(r.ledger)}` })}</div> : null}
                </Td>
                <Td className="tabular">
                  {fmt(r.limit)} {r.ratio !== null && r.ratio >= 1 ? <Badge tone="danger">{t("admin.plans.manager.atLimit")}</Badge> : null}
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      </Card>

      <Card>
        <CardHeader title={t("admin.plans.manager.overrides")} />
        {overrides.length === 0 ? (
          <CardBody>
            <p className="text-sm text-muted-foreground">{t("admin.plans.manager.noOverrides")}</p>
          </CardBody>
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>{t("admin.plans.manager.key")}</Th>
                <Th>{t("admin.plans.manager.value")}</Th>
                <Th>{t("common.reason")}</Th>
                <Th>{t("admin.plans.manager.expiresAt")}</Th>
                <Th />
              </Tr>
            </THead>
            <TBody>
              {overrides.map((o) => (
                <Tr key={o.id}>
                  <Td className="font-mono text-xs">{o.key}</Td>
                  <Td className="tabular">{!o.enabled ? t("admin.plans.manager.excluded") : o.limitValue === null ? (o.key.startsWith("feature.") ? t("admin.plans.manager.included") : "∞") : formatNumber(o.limitValue, locale)}</Td>
                  <Td className="text-xs">{o.reason}</Td>
                  <Td className="text-xs">{o.expiresAt ? formatDate(o.expiresAt, locale, tz) : "—"}</Td>
                  <Td>{o.revokedAt ? <Badge tone="neutral">{t("admin.plans.manager.revoked")}</Badge> : manage ? <RevokeOverrideButton overrideId={o.id} /> : null}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Card>

      <Card>
        <CardHeader title={t("admin.plans.manager.addons")} />
        {addons.length === 0 ? (
          <CardBody>
            <p className="text-sm text-muted-foreground">{t("admin.plans.manager.noAddons")}</p>
          </CardBody>
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>{t("admin.plans.manager.addon")}</Th>
                <Th>{t("admin.plans.manager.packs")}</Th>
                <Th>{t("admin.plans.manager.status")}</Th>
                <Th>{t("admin.plans.manager.source")}</Th>
                <Th>{t("admin.plans.manager.window")}</Th>
              </Tr>
            </THead>
            <TBody>
              {addons.map((a) => (
                <Tr key={a.id}>
                  <Td className="font-mono text-xs">{a.addonKey}</Td>
                  <Td className="tabular">
                    {a.packs} · +{formatNumber(a.quantity, locale)}
                  </Td>
                  <Td>
                    <Badge tone={a.status === "PAID" ? "success" : a.status === "PENDING" ? "warning" : "neutral"}>{a.status}</Badge>
                  </Td>
                  <Td className="text-xs">{a.source}</Td>
                  <Td className="text-xs">{a.windowStart && a.windowEnd ? `${formatDate(a.windowStart, locale, tz)} – ${formatDate(a.windowEnd, locale, tz)}` : "—"}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
