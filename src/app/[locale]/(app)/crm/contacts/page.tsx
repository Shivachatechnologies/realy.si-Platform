import type { Metadata } from "next";
import Link from "next/link";
import { Download } from "lucide-react";
import { BulkTable, SaveSegment } from "@/components/crm/kit";
import { ContactForm } from "@/components/crm/record-forms";
import { CrmFrame, Pager, TagList, crmContext } from "@/components/crm/shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { getT } from "@/i18n/server";
import { formatDate } from "@/i18n/format";
import { accountOptions } from "@/server/modules/crm/accounts";
import { listSegments } from "@/server/modules/crm/config";
import { contactName, listContacts, parseContactFilters } from "@/server/modules/crm/contacts";
import { listFieldDefs } from "@/server/modules/crm/custom-fields";
import { listOwners } from "@/server/modules/crm/service";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("crm.tabs.contacts") };
}

export default async function ContactsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const c = await crmContext();
  const t = c.t;
  const query = await searchParams;
  if (!c.company || !c.canRead) return <CrmFrame active="contacts" subtitle={t("crm.contacts.subtitle")}>{null}</CrmFrame>;
  const { locale, base, org, company, viewer, tz } = c;
  const filters = parseContactFilters(query);
  const [list, owners, accounts, fields, segments] = await Promise.all([
    listContacts(viewer.ctx, org.id, company.id, filters),
    listOwners(viewer.ctx, org.id, company.id),
    accountOptions(viewer.ctx, org.id, company.id),
    listFieldDefs(viewer.ctx, org.id, company.id, "CONTACT"),
    listSegments(viewer.ctx, org.id, company.id, "CONTACT"),
  ]);
  const active: Record<string, string> = {};
  for (const k of ["q", "owner", "account", "tag", "consent", "sort"]) if (typeof query[k] === "string" && query[k]) active[k] = query[k] as string;
  const qs = new URLSearchParams(active).toString();
  const filtered = Object.keys(active).some((k) => k !== "sort");
  return (
    <CrmFrame
      active="contacts"
      subtitle={t("crm.contacts.subtitle")}
      actions={
        <Button asChild size="sm" variant="secondary">
          <a href={`${base}/crm/export/contacts${qs ? `?${qs}` : ""}`}>
            <Download aria-hidden />
            {t("crm.exportCsv")}
          </a>
        </Button>
      }
    >
      {segments.length ? (
        <nav className="flex flex-wrap items-center gap-2 text-sm" aria-label={t("crm.segments.title")}>
          <span className="text-xs text-muted-foreground">{t("crm.segments.title")}:</span>
          {segments.map((s) => (
            <Link key={s.id} href={`/${locale}/crm/contacts?${new URLSearchParams(s.filters as Record<string, string>)}`} className="rounded-full border px-2 py-0.5 text-xs hover:bg-muted">
              {s.name}
            </Link>
          ))}
        </nav>
      ) : null}
      <Card>
        <CardHeader title={t("crm.tabs.contacts")} description={t("crm.contacts.count", { count: list.total })} actions={<SaveSegment base={base} entity="CONTACT" filters={active} />} />
        <form className="grid gap-2 border-b p-3 sm:grid-cols-[minmax(0,1fr)_10rem_10rem_8rem_8rem_8rem_auto]" action={`/${locale}/crm/contacts`}>
          <Input name="q" type="search" defaultValue={filters.q ?? ""} maxLength={200} aria-label={t("crm.search")} placeholder={t("crm.contacts.searchPlaceholder")} />
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
          <Select name="account" defaultValue={filters.accountId ?? ""} aria-label={t("crm.fields.account")}>
            <option value="">{t("crm.allAccounts")}</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
          <Input name="tag" defaultValue={filters.tag ?? ""} maxLength={40} aria-label={t("crm.tag")} placeholder={t("crm.tag")} />
          <Select name="consent" defaultValue={filters.consent ?? ""} aria-label={t("crm.fields.marketingConsent")}>
            <option value="">{t("crm.contacts.anyConsent")}</option>
            <option value="yes">{t("crm.contacts.consentYes")}</option>
            <option value="no">{t("crm.contacts.consentNo")}</option>
          </Select>
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
              <Link href={`/${locale}/crm/contacts`} className="self-center text-xs text-muted-foreground hover:underline">
                {t("crm.clearFilters")}
              </Link>
            ) : null}
          </div>
        </form>
        {c.canManage ? (
          <details className="border-b">
            <summary className="cursor-pointer p-3 text-sm font-medium">{t("crm.contacts.add")}</summary>
            <ContactForm base={base} locale={locale} owners={owners} accounts={accounts} fields={fields} viewerId={viewer.user.id} />
          </details>
        ) : null}
        {list.rows.length === 0 ? (
          <p className="p-4 text-muted-foreground">{filtered ? t("common.noResults") : t("crm.contacts.empty")}</p>
        ) : (
          <BulkTable
            url={`${base}/crm/contacts/bulk`}
            canManage={c.canManage}
            columns={[{ label: t("crm.name") }, { label: t("crm.fields.account") }, { label: t("crm.email") }, { label: t("crm.phone") }, { label: t("crm.owner") }, { label: t("crm.created") }]}
            actions={[
              { kind: "assign", owners },
              { kind: "select", action: "account", field: "accountId", label: t("crm.contacts.setAccount"), options: [{ value: "", label: t("common.none") }, ...accounts.map((a) => ({ value: a.id, label: a.name }))] },
              { kind: "tag" },
              { kind: "archive" },
            ]}
            rows={list.rows.map((r) => ({
              id: r.id,
              label: contactName(r),
              cells: [
                <span key="n" className="grid gap-0.5">
                  <Link href={`/${locale}/crm/contacts/${r.id}`} className="font-medium hover:underline">
                    {contactName(r)}
                  </Link>
                  <span className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                    {r.title}
                    {r.marketingConsent ? <Badge tone="success">{t("crm.contacts.consentBadge")}</Badge> : null}
                    <TagList tags={r.tags} />
                  </span>
                </span>,
                r.account ? (
                  <Link key="a" href={`/${locale}/crm/accounts/${r.account.id}`} className="hover:underline">
                    {r.account.name}
                  </Link>
                ) : (
                  "—"
                ),
                r.email ?? "—",
                r.phone ?? "—",
                r.owner?.name ?? <span className="text-muted-foreground">{t("crm.unassigned")}</span>,
                <span key="d" className="text-xs text-muted-foreground">
                  {formatDate(r.createdAt, locale, tz)}
                </span>,
              ],
            }))}
          />
        )}
        <Pager path={`/${locale}/crm/contacts`} query={query} page={list.page} pageSize={list.pageSize} total={list.total} />
      </Card>
    </CrmFrame>
  );
}
