import { SmartEmpty } from "@/components/crm/page-intro";
import Link from "next/link";
import { Download } from "lucide-react";
import { BulkTable, SaveSegment } from "@/components/crm/kit";
import { AccountForm } from "@/components/crm/record-forms";
import { Pager, TagList, crmContext } from "@/components/crm/shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { ACCOUNT_TYPES, listAccounts, parseAccountFilters } from "@/server/modules/crm/accounts";
import { listSegments, sourceNames } from "@/server/modules/crm/config";
import { listFieldDefs } from "@/server/modules/crm/custom-fields";
import { listOwners } from "@/server/modules/crm/service";

export const TYPE_TONE = { PROSPECT: "neutral", CUSTOMER: "success", PARTNER: "accent", VENDOR: "warning", OTHER: "neutral" } as const;

/** Accounts list with filters, segments, bulk actions, export and the create form. `fixedType` locks the type filter (Customers page). */
export async function AccountsList({ path, query, fixedType }: { path: string; query: Record<string, string | string[] | undefined>; fixedType?: "CUSTOMER" }) {
  const c = await crmContext();
  if (!c.company) return null;
  const { t, locale, base, org, company, viewer } = c;
  const filters = { ...parseAccountFilters(query), ...(fixedType ? { type: fixedType } : {}) };
  const [list, owners, sources, fields, segments] = await Promise.all([
    listAccounts(viewer.ctx, org.id, company.id, filters),
    listOwners(viewer.ctx, org.id, company.id),
    sourceNames(viewer.ctx, org.id, company.id),
    listFieldDefs(viewer.ctx, org.id, company.id, "ACCOUNT"),
    listSegments(viewer.ctx, org.id, company.id, "ACCOUNT"),
  ]);
  const active: Record<string, string> = {};
  for (const k of ["q", "type", "owner", "tag", "sort"]) if (typeof query[k] === "string" && query[k]) active[k] = query[k] as string;
  if (fixedType) active.type = fixedType;
  const qs = new URLSearchParams(active).toString();
  const filtered = Object.keys(active).some((k) => k !== "sort" && !(fixedType && k === "type"));
  return (
    <>
      {segments.length ? (
        <nav className="flex flex-wrap items-center gap-2 text-sm" aria-label={t("crm.segments.title")}>
          <span className="text-xs text-muted-foreground">{t("crm.segments.title")}:</span>
          {segments.map((s) => (
            <Link key={s.id} href={`/${locale}/crm/accounts?${new URLSearchParams(s.filters as Record<string, string>)}`} className="rounded-full border px-2 py-0.5 text-xs hover:bg-muted">
              {s.name}
            </Link>
          ))}
        </nav>
      ) : null}
      <Card>
        <CardHeader
          title={fixedType ? t("crm.accountTypes.CUSTOMER") : t("crm.tabs.accounts")}
          description={t("crm.accounts.count", { count: list.total })}
          actions={
            <>
              {fixedType ? null : <SaveSegment base={base} entity="ACCOUNT" filters={active} />}
              <Button asChild size="sm" variant="secondary">
                <a href={`${base}/crm/export/accounts${qs ? `?${qs}` : ""}`}>
                  <Download aria-hidden />
                  {t("crm.exportCsv")}
                </a>
              </Button>
            </>
          }
        />
        <form className="grid gap-2 border-b p-3 sm:grid-cols-[minmax(0,1fr)_9rem_10rem_8rem_8rem_auto]" action={path}>
          <Input name="q" type="search" defaultValue={filters.q ?? ""} maxLength={200} aria-label={t("crm.search")} placeholder={t("crm.accounts.searchPlaceholder")} />
          {fixedType ? (
            <span />
          ) : (
            <Select name="type" defaultValue={filters.type ?? ""} aria-label={t("crm.fields.type")}>
              <option value="">{t("crm.allTypes")}</option>
              {ACCOUNT_TYPES.map((x) => (
                <option key={x} value={x}>
                  {t(`crm.accountTypes.${x}`)}
                </option>
              ))}
            </Select>
          )}
          <Select name="owner" defaultValue={filters.owner ?? ""} aria-label={t("crm.owner")}>
            <option value="">{t("crm.allOwners")}</option>
            <option value="me">{t("crm.mine")}</option>
            <option value="unassigned">{t("crm.unassigned")}</option>
            {owners.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </Select>
          <Input name="tag" defaultValue={filters.tag ?? ""} maxLength={40} aria-label={t("crm.tag")} placeholder={t("crm.tag")} />
          <Select name="sort" defaultValue={filters.sort ?? ""} aria-label={t("crm.sort")}>
            <option value="">{t("crm.sortName")}</option>
            <option value="created">{t("crm.sortCreated")}</option>
            <option value="updated">{t("crm.sortUpdated")}</option>
          </Select>
          <div className="flex gap-2">
            <Button type="submit" variant="secondary">
              {t("crm.applyFilters")}
            </Button>
            {filtered ? (
              <Link href={path} className="self-center text-xs text-muted-foreground hover:underline">
                {t("crm.clearFilters")}
              </Link>
            ) : null}
          </div>
        </form>
        {c.canManage ? (
          <details id="new-item" className="border-b" open={list.rows.length === 0 && !filtered}>
            <summary className="cursor-pointer p-3 text-sm font-medium">{t("crm.accounts.add")}</summary>
            <AccountForm base={base} locale={locale} owners={owners} sources={sources} fields={fields} defaultType={fixedType ?? "PROSPECT"} viewerId={viewer.user.id} />
          </details>
        ) : null}
        {list.rows.length === 0 ? (
          filtered ? <p className="p-4 text-muted-foreground">{t("common.noResults")}</p> : <SmartEmpty ns="crm.smartEmpty.accounts" primaryHref="#new-item" aiHref={`/${locale}/sales/start`} />
        ) : (
          <BulkTable
            url={`${base}/crm/accounts/bulk`}
            canManage={c.canManage}
            columns={[{ label: t("crm.name") }, { label: t("crm.fields.type") }, { label: t("crm.fields.industry") }, { label: t("crm.owner") }, { label: t("crm.tabs.contacts"), align: "end" }, { label: t("crm.accounts.openDeals"), align: "end" }]}
            actions={[
              { kind: "assign", owners },
              { kind: "select", action: "type", field: "type", label: t("crm.accounts.setType"), options: ACCOUNT_TYPES.map((x) => ({ value: x, label: t(`crm.accountTypes.${x}`) })) },
              { kind: "tag" },
              { kind: "archive" },
            ]}
            rows={list.rows.map((r) => ({
              id: r.id,
              label: r.name,
              cells: [
                <span key="n" className="grid gap-0.5">
                  <Link href={`/${locale}/crm/accounts/${r.id}`} className="font-medium hover:underline">
                    {r.name}
                  </Link>
                  <span className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                    {r.domain}
                    <TagList tags={r.tags} />
                  </span>
                </span>,
                <Badge key="t" tone={TYPE_TONE[r.type]}>
                  {t(`crm.accountTypes.${r.type}`)}
                </Badge>,
                r.industry ?? "—",
                r.owner?.name ?? <span className="text-muted-foreground">{t("crm.unassigned")}</span>,
                r._count.contacts,
                r._count.crmDeals,
              ],
            }))}
          />
        )}
        <Pager path={path} query={query} page={list.page} pageSize={list.pageSize} total={list.total} />
      </Card>
    </>
  );
}
