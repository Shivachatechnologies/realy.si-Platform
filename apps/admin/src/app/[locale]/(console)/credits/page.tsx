import Link from "next/link";
import { Coins, SearchX } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { AdminBreadcrumbs } from "@/components/admin/nav/breadcrumbs";
import { AdminHeader, EmptyState, FilterBar, NextPage, QuickFilters, SectionLink, guard, sp } from "@/components/admin/kit";
import { StatusBadge } from "@/components/admin/status-badge";
import { Timestamp } from "@/components/admin/timestamp";
import { CreditAdjustButton } from "@/components/admin/billing/actions";
import { DataSource } from "@/components/admin/billing/ui";
import { getLocale, getT } from "@/i18n/server";
import { formatDate, formatNumber } from "@/i18n/format";
import { canPlatform } from "@/server/modules/admin/access";
import { creditBalances, creditLedger } from "@/server/modules/admin/credits";
import { LEDGER_KINDS, LEDGER_METERS } from "@/server/modules/entitlements/ledger";
import { searchOrganizations } from "@/server/modules/entitlements/admin";
import { requireViewer } from "@/server/session";

/** Credits center: the signed credit ledger across organizations, balances of one organization, admin adjustments. */
export default async function CreditsPage({ searchParams }: PageProps<"/[locale]/credits">) {
  const locale = await getLocale();
  const t = await getT(locale);
  const viewer = await requireViewer(locale);
  const q = await searchParams;
  const params = { org: sp(q.org), meter: sp(q.meter), kind: sp(q.kind), from: sp(q.from), to: sp(q.to), limit: sp(q.limit) };
  const find = sp(q.find);
  const res = await guard(creditLedger(viewer.ctx, { ...params, cursor: sp(q.cursor) }), t("errors.forbidden"));
  if (!res.ok) return res.node;
  const { page, byKind } = res.value;
  const [balances, canAdjust, found] = await Promise.all([
    params.org ? creditBalances(viewer.ctx, params.org).catch(() => null) : Promise.resolve(null),
    canPlatform(viewer.ctx, "platform.subscriptions.manage"),
    find ? searchOrganizations(viewer.ctx, find).catch(() => []) : Promise.resolve([]),
  ]);
  const base = `/${locale}/credits`;
  const tz = viewer.user.timezone;
  const n = (v: number | bigint | null) => (v === null ? "∞" : formatNumber(v, locale));
  const anyFilter = Object.entries(params).some(([k, v]) => k !== "limit" && !!v);
  return (
    <div className="grid gap-4">
      <AdminBreadcrumbs />
      <AdminHeader
        icon={<Coins />}
        title={t("admin.credits.title")}
        description={t("admin.credits.subtitle")}
        why={t("admin.credits.why")}
        actions={<SectionLink href={`/${locale}/usage`}>{t("admin.usage.title")}</SectionLink>}
        meta={<DataSource source={t("admin.credits.source")} />}
      />
      <Card>
        <CardHeader title={t("admin.credits.balances")} description={t("admin.credits.balancesHint")} />
        <CardBody className="grid gap-3">
          <form className="flex gap-2" action={base}>
            <Input name="find" defaultValue={find ?? ""} placeholder={t("admin.plans.manager.orgSearch")} aria-label={t("admin.plans.manager.orgSearch")} />
          </form>
          {find && found.length === 0 ? <p className="text-sm text-muted-foreground">{t("admin.plans.manager.noOrgs")}</p> : null}
          {found.length ? (
            <ul className="flex flex-wrap gap-2">
              {found.map((o) => (
                <li key={o.id}>
                  <Link href={`${base}?org=${o.id}`} className="text-sm text-primary hover:underline">{o.name}</Link>
                </li>
              ))}
            </ul>
          ) : null}
          {balances ? (
            <div className="grid gap-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm">
                  <Link href={`/${locale}/organizations/${balances.org.id}`} className="font-medium hover:underline">{balances.org.name}</Link>{" "}
                  <span className="text-muted-foreground">
                    · {balances.plan} · {formatDate(balances.window.start, locale, tz)} – {formatDate(balances.window.end, locale, tz)}
                  </span>
                </p>
                {canAdjust ? <CreditAdjustButton organizationId={balances.org.id} meters={[...LEDGER_METERS]} /> : null}
              </div>
              {!balances.enforced ? <Notice tone="warning">{t("admin.plans.manager.notEnforced")}</Notice> : null}
              <Table>
                <THead>
                  <Tr>
                    <Th>{t("admin.credits.meter")}</Th>
                    <Th>{t("admin.credits.planGrant")}</Th>
                    <Th>{t("admin.credits.addons")}</Th>
                    <Th>{t("admin.credits.adjustments")}</Th>
                    <Th>{t("admin.credits.used")}</Th>
                    <Th>{t("admin.credits.remaining")}</Th>
                  </Tr>
                </THead>
                <TBody>
                  {balances.meters.map((mt) => (
                    <Tr key={mt.meter}>
                      <Td>
                        <Link href={`${base}?org=${balances.org.id}&meter=${mt.meter}`} className="font-mono text-xs hover:underline">{mt.meter}</Link>
                        <div className="text-[11px] text-muted-foreground">{mt.unit}</div>
                      </Td>
                      <Td className="tabular text-xs">{n(mt.planLimit)}</Td>
                      <Td className="tabular text-xs">{mt.addon ? `+${n(mt.addon)}` : "—"}</Td>
                      <Td className="tabular text-xs">{mt.ledger ? `${mt.ledger > 0 ? "+" : ""}${n(mt.ledger)}` : "—"}</Td>
                      <Td className="tabular text-xs">{n(mt.used)}</Td>
                      <Td className={`tabular text-xs ${mt.ratio !== null && mt.ratio >= 1 ? "text-danger" : ""}`}>{n(mt.remaining)}</Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            </div>
          ) : params.org ? (
            <p className="text-sm text-muted-foreground">{t("admin.credits.orgNotFound")}</p>
          ) : (
            <p className="text-sm text-muted-foreground">{t("admin.credits.pickOrg")}</p>
          )}
        </CardBody>
      </Card>
      <Card>
        <CardHeader title={t("admin.credits.ledger")} description={t("admin.credits.ledgerHint")} />
        <QuickFilters
          base={base}
          name="kind"
          value={params.kind}
          params={params}
          label={t("admin.credits.kind")}
          options={[{ value: "", label: t("admin.invoices.common.all") }, ...LEDGER_KINDS.map((k) => ({ value: k, label: t(`admin.credits.kinds.${k}`), count: byKind.find((b) => b.kind === k)?.count ?? 0 }))]}
        />
        <FilterBar
          action={base}
          values={params}
          submitLabel={t("admin.invoices.common.apply")}
          filters={[
            { name: "meter", label: t("admin.credits.meter"), options: LEDGER_METERS.map((m) => ({ value: m, label: m })) },
            { name: "limit", label: t("admin.invoices.common.pageSize"), options: ["25", "50", "100", "200"].map((x) => ({ value: x, label: x })) },
          ]}
          extra={
            <>
              {params.org ? <input type="hidden" name="org" value={params.org} /> : null}
              {params.kind ? <input type="hidden" name="kind" value={params.kind} /> : null}
              <Input name="from" type="date" defaultValue={params.from} aria-label={t("admin.invoices.common.from")} className="w-auto" />
              <Input name="to" type="date" defaultValue={params.to} aria-label={t("admin.invoices.common.to")} className="w-auto" />
              {anyFilter ? <Link href={base} className="text-xs text-primary hover:underline">{t("admin.invoices.common.reset")}</Link> : null}
            </>
          }
        />
        {page.data.length === 0 ? (
          <EmptyState icon={<SearchX />} title={t("admin.credits.empty")} body={t("admin.credits.emptyHint")} />
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>{t("admin.credits.kind")}</Th>
                <Th>{t("admin.invoices.common.organization")}</Th>
                <Th>{t("admin.credits.meter")}</Th>
                <Th>{t("admin.credits.delta")}</Th>
                <Th>{t("admin.credits.period")}</Th>
                <Th>{t("admin.credits.by")}</Th>
                <Th>{t("admin.invoices.common.created")}</Th>
              </Tr>
            </THead>
            <TBody>
              {page.data.map((e) => (
                <Tr key={e.id}>
                  <Td>
                    <StatusBadge domain="creditLedger" value={e.kind}>{t(`admin.credits.kinds.${e.kind}`)}</StatusBadge>
                    {e.reason ? <div className="max-w-56 truncate text-[11px] text-muted-foreground" title={e.reason}>{e.reason}</div> : null}
                  </Td>
                  <Td className="text-xs">
                    <Link href={`${base}?org=${e.organizationId}`} className="hover:underline">{e.organizationName ?? e.organizationId}</Link>
                  </Td>
                  <Td className="font-mono text-xs">{e.meter}</Td>
                  <Td className={`tabular text-xs ${e.delta < 0n ? "text-danger" : "text-success"}`}>{e.delta > 0n ? "+" : ""}{formatNumber(e.delta, locale)}</Td>
                  <Td className="font-mono text-xs">{e.periodKey}</Td>
                  <Td className="text-xs">{e.actorName ?? (e.sourceType ? t(`admin.credits.sources.${e.sourceType}`) : "—")}</Td>
                  <Td className="text-xs whitespace-nowrap text-muted-foreground"><Timestamp value={e.createdAt} mode="absolute" /></Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
        <NextPage base={base} params={params} cursor={page.nextCursor} label={t("common.next")} />
      </Card>
    </div>
  );
}
