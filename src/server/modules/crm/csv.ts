import { z } from "zod";
import { transaction, type Tx } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { writeAudit } from "@/server/modules/audit/service";
import { accountInput, insertAccount, listAccounts, parseAccountFilters } from "./accounts";
import { authorize, eligibleOwnerIds, isoDay, toMajor } from "./common";
import { contactInput, contactName, insertContact, listContacts, parseContactFilters } from "./contacts";
import { dealInput, insertDeal, listDeals, parseDealFilters } from "./deals";
import { normalizeEmail, normalizePhone } from "./scoring";
import { createLead, createLeadInput, listLeads, parseLeadFilters } from "./service";

/** CSV import (paste/upload → preview → import with duplicate detection) and export for leads, contacts, accounts, deals. */

export const CSV_ENTITIES = ["leads", "contacts", "accounts", "deals"] as const;
export type CsvEntity = (typeof CSV_ENTITIES)[number];
const MAX_ROWS = 2000;

export const importInput = z.object({
  entity: z.enum(CSV_ENTITIES),
  csv: z.string().min(1).max(2_000_000),
  mode: z.enum(["preview", "commit"]).default("preview"),
});

/** RFC 4180 parser (quoted fields, escaped quotes, CRLF); also accepts ";" or tab delimited files. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const firstLine = src.split(/\r?\n/, 1)[0] ?? "";
  const delim = [",", ";", "\t"].map((d) => [d, firstLine.split(d).length] as const).sort((a, b) => b[1] - a[1])[0]![0];
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"' && field === "") quoted = true;
    else if (c === delim) {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((f) => f.trim())) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim())) rows.push(row);
  return rows;
}

/** Spreadsheet-safe CSV cell (formula injection guarded). */
function cell(v: unknown): string {
  let s = v == null ? "" : v instanceof Date ? v.toISOString() : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export const toCsv = (header: string[], rows: unknown[][]) => [header, ...rows].map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";

const ALIASES: Record<CsvEntity, Record<string, string[]>> = {
  leads: {
    name: ["name", "full name", "lead", "contact"],
    email: ["email", "e-mail", "email address"],
    phone: ["phone", "telephone", "mobile"],
    account: ["company", "account", "organization", "organisation"],
    source: ["source", "lead source"],
    value: ["value", "amount", "deal value"],
    territory: ["territory", "region", "country"],
    notes: ["notes", "note", "comments"],
    tags: ["tags", "labels"],
    owner: ["owner", "owner email", "assigned to"],
  },
  contacts: {
    firstName: ["first name", "firstname", "given name"],
    lastName: ["last name", "lastname", "surname", "family name"],
    name: ["name", "full name"],
    email: ["email", "e-mail", "email address"],
    phone: ["phone", "telephone", "mobile"],
    title: ["title", "job title", "position"],
    account: ["company", "account", "organization", "organisation"],
    tags: ["tags", "labels"],
    owner: ["owner", "owner email"],
  },
  accounts: {
    name: ["name", "company", "account", "account name"],
    type: ["type", "account type"],
    domain: ["domain"],
    website: ["website", "url", "web"],
    industry: ["industry"],
    email: ["email"],
    phone: ["phone"],
    countryCode: ["country", "country code"],
    territory: ["territory", "region"],
    source: ["source"],
    tags: ["tags", "labels"],
    owner: ["owner", "owner email"],
  },
  deals: {
    name: ["name", "deal", "deal name", "opportunity"],
    amount: ["amount", "value", "deal value"],
    currency: ["currency"],
    stage: ["stage"],
    account: ["account", "company", "organization"],
    expectedCloseDate: ["expected close", "close date", "expected close date"],
    probability: ["probability", "probability (%)"],
    source: ["source"],
    campaignCode: ["campaign", "campaign code"],
    owner: ["owner", "owner email"],
    tags: ["tags", "labels"],
  },
};

function mapRows(entity: CsvEntity, rows: string[][]) {
  const [header = [], ...body] = rows;
  const norm = header.map((h) => h.trim().toLowerCase().replace(/[_]+/g, " "));
  const index: Record<string, number> = {};
  for (const [field, aliases] of Object.entries(ALIASES[entity])) {
    const i = norm.findIndex((h) => aliases.includes(h) || h === field.toLowerCase());
    if (i >= 0) index[field] = i;
  }
  return {
    columns: Object.keys(index),
    records: body.slice(0, MAX_ROWS).map((r) => Object.fromEntries(Object.entries(index).map(([f, i]) => [f, (r[i] ?? "").trim()])) as Record<string, string>),
    truncated: body.length > MAX_ROWS,
  };
}

type PreviewRow = { line: number; status: "new" | "duplicate" | "invalid"; label: string; error?: string; data: Record<string, unknown> };

const splitTags = (s?: string) => (s ? s.split(/[|,;]/).map((t) => t.trim()).filter(Boolean).slice(0, 30) : undefined);
const num = (s?: string) => (s ? s.replace(/[^\d.]/g, "") || undefined : undefined);

/** Build validated inputs and flag duplicates (existing records or earlier rows of the same file). */
async function prepare(tx: Tx, ctx: RequestContext, organizationId: string, companyId: string, entity: CsvEntity, records: Record<string, string>[], chain: Awaited<ReturnType<typeof authorize>>) {
  const owners = await eligibleOwnerIds(tx, organizationId, chain);
  const ownerUsers = await tx.user.findMany({ where: { id: { in: owners } }, select: { id: true, email: true, name: true } });
  const ownerOf = (v?: string) => {
    if (!v) return undefined;
    const k = v.trim().toLowerCase();
    return ownerUsers.find((u) => u.email.toLowerCase() === k || u.name.toLowerCase() === k)?.id;
  };
  const seen = new Set<string>();
  const out: PreviewRow[] = [];
  for (const [i, r] of records.entries()) {
    const line = i + 2;
    try {
      if (entity === "leads") {
        const data = { name: r.name ?? "", email: r.email || undefined, phone: r.phone || undefined, account: r.account || undefined, source: r.source || undefined, value: num(r.value), territory: r.territory || undefined, notes: r.notes || undefined, tags: splitTags(r.tags), ownerId: ownerOf(r.owner), allowDuplicate: true };
        const parsed = createLeadInput.safeParse(data);
        if (!parsed.success) throw new Error(parsed.error.issues[0]?.path.join(".") || "invalid");
        const keys = [normalizeEmail(data.email), normalizePhone(data.phone)].filter(Boolean) as string[];
        const dup = keys.some((k) => seen.has(k)) || (keys.length && (await tx.lead.count({ where: { companyId, archivedAt: null, OR: [{ emailNormalized: { in: keys } }, { phoneNormalized: { in: keys } }] } })));
        keys.forEach((k) => seen.add(k));
        out.push({ line, status: dup ? "duplicate" : "new", label: data.name, data });
      } else if (entity === "contacts") {
        const [first, ...rest] = (r.name ?? "").split(/\s+/);
        const accountName = r.account || undefined;
        const data = { firstName: r.firstName || first || "", lastName: r.lastName || rest.join(" ") || undefined, email: r.email || undefined, phone: r.phone || undefined, title: r.title || undefined, tags: splitTags(r.tags), ownerId: ownerOf(r.owner), allowDuplicate: true };
        const parsed = contactInput.safeParse(data);
        if (!parsed.success) throw new Error(parsed.error.issues[0]?.path.join(".") || "invalid");
        const keys = [normalizeEmail(data.email), normalizePhone(data.phone)].filter(Boolean) as string[];
        const dup = keys.some((k) => seen.has(k)) || (keys.length && (await tx.contact.count({ where: { companyId, archivedAt: null, OR: [{ emailNormalized: { in: keys } }, { phoneNormalized: { in: keys } }] } })));
        keys.forEach((k) => seen.add(k));
        out.push({ line, status: dup ? "duplicate" : "new", label: contactName({ firstName: data.firstName, lastName: data.lastName ?? null }), data: { ...data, accountName } });
      } else if (entity === "accounts") {
        const type = r.type?.toUpperCase();
        const data = {
          name: r.name ?? "",
          type: ["PROSPECT", "CUSTOMER", "PARTNER", "VENDOR", "OTHER"].includes(type ?? "") ? type : "PROSPECT",
          domain: r.domain || undefined,
          website: r.website || undefined,
          industry: r.industry || undefined,
          email: r.email || undefined,
          phone: r.phone || undefined,
          countryCode: r.countryCode && r.countryCode.length === 2 ? r.countryCode.toUpperCase() : undefined,
          territory: r.territory || undefined,
          source: r.source || undefined,
          tags: splitTags(r.tags),
          ownerId: ownerOf(r.owner),
          allowDuplicate: true,
        };
        const parsed = accountInput.safeParse(data);
        if (!parsed.success) throw new Error(parsed.error.issues[0]?.path.join(".") || "invalid");
        const k = data.name.toLowerCase();
        const dup = seen.has(k) || (await tx.account.count({ where: { companyId, archivedAt: null, OR: [{ name: { equals: data.name, mode: "insensitive" } }, ...(data.domain ? [{ domain: { equals: data.domain, mode: "insensitive" as const } }] : [])] } }));
        seen.add(k);
        out.push({ line, status: dup ? "duplicate" : "new", label: data.name, data });
      } else {
        const data = {
          name: r.name ?? "",
          amount: num(r.amount),
          currency: r.currency?.toUpperCase() || undefined,
          expectedCloseDate: /^\d{4}-\d{2}-\d{2}$/.test(r.expectedCloseDate ?? "") ? r.expectedCloseDate : undefined,
          probability: r.probability ? Math.max(0, Math.min(100, Math.round(Number(num(r.probability)) || 0))) : undefined,
          source: r.source || undefined,
          campaignCode: r.campaignCode || undefined,
          ownerId: ownerOf(r.owner),
          tags: splitTags(r.tags),
        };
        const parsed = dealInput.safeParse(data);
        if (!parsed.success) throw new Error(parsed.error.issues[0]?.path.join(".") || "invalid");
        const k = `${data.name.toLowerCase()}|${(r.account ?? "").toLowerCase()}`;
        const dup = seen.has(k) || (await tx.crmDeal.count({ where: { companyId, archivedAt: null, name: { equals: data.name, mode: "insensitive" }, ...(r.account ? { account: { name: { equals: r.account, mode: "insensitive" } } } : {}) } }));
        seen.add(k);
        out.push({ line, status: dup ? "duplicate" : "new", label: data.name, data: { ...data, accountName: r.account || undefined, stageName: r.stage || undefined } });
      }
    } catch (err) {
      out.push({ line, status: "invalid", label: r.name || r.firstName || "", error: err instanceof Error ? err.message : "invalid", data: {} });
    }
  }
  return out;
}

async function accountByName(tx: Tx, ctx: RequestContext, organizationId: string, companyId: string, name: string | undefined, cache: Map<string, string>) {
  if (!name) return undefined;
  const k = name.toLowerCase();
  if (cache.has(k)) return cache.get(k);
  const existing = await tx.account.findFirst({ where: { companyId, archivedAt: null, name: { equals: name, mode: "insensitive" } }, select: { id: true } });
  const id = existing?.id ?? (await insertAccount(tx, ctx, organizationId, companyId, accountInput.parse({ name, allowDuplicate: true }))).id;
  cache.set(k, id);
  return id;
}

/** Preview (no writes) or import the rows marked "new"; duplicates and invalid rows are skipped. */
export async function importCsv(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof importInput>) {
  const input = importInput.parse(raw);
  const { columns, records, truncated } = mapRows(input.entity, parseCsv(input.csv));
  if (input.mode === "preview") {
    const chain = await authorize(ctx, organizationId, companyId, "sales.manage");
    const rows = await transaction((tx) => prepare(tx, ctx, organizationId, companyId, input.entity, records, chain), { timeout: 60_000 });
    return { columns, truncated, rows, counts: count(rows) };
  }
  // Leads go through createLead (scoring, auto-assignment, events) one by one, outside one big transaction.
  if (input.entity === "leads") {
    const chain = await authorize(ctx, organizationId, companyId, "sales.manage");
    const rows = await transaction((tx) => prepare(tx, ctx, organizationId, companyId, "leads", records, chain), { timeout: 60_000 });
    let created = 0;
    for (const r of rows.filter((r) => r.status === "new")) {
      await createLead(ctx, organizationId, companyId, r.data as Parameters<typeof createLead>[3]);
      created++;
    }
    return { columns, truncated, created, counts: count(rows) };
  }
  return transaction(
    async (tx) => {
      const chain = await authorize(ctx, organizationId, companyId, "sales.manage", tx);
      const rows = await prepare(tx, ctx, organizationId, companyId, input.entity, records, chain);
      const accounts = new Map<string, string>();
      let created = 0;
      for (const r of rows.filter((r) => r.status === "new")) {
        if (input.entity === "contacts") {
          const { accountName, ...data } = r.data as Record<string, unknown> & { accountName?: string };
          const accountId = await accountByName(tx, ctx, organizationId, companyId, accountName, accounts);
          await insertContact(tx, ctx, organizationId, companyId, contactInput.parse({ ...data, accountId }));
        } else if (input.entity === "accounts") {
          await insertAccount(tx, ctx, organizationId, companyId, accountInput.parse(r.data));
        } else {
          const { accountName, stageName, ...data } = r.data as Record<string, unknown> & { accountName?: string; stageName?: string };
          const accountId = await accountByName(tx, ctx, organizationId, companyId, accountName, accounts);
          const stage = stageName
            ? await tx.crmPipelineStage.findFirst({ where: { companyId, archivedAt: null, name: { equals: stageName, mode: "insensitive" }, pipeline: { isDefault: true, archivedAt: null } }, select: { id: true, pipelineId: true } })
            : null;
          await insertDeal(tx, ctx, organizationId, companyId, dealInput.parse({ ...data, accountId, pipelineId: stage?.pipelineId, stageId: stage?.id }));
        }
        created++;
      }
      await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: `crm.import.${input.entity}`, resourceType: "crm_import", resourceId: companyId, newValue: { created, ...count(rows) } });
      return { columns, truncated, created, counts: count(rows) };
    },
    { timeout: 120_000 },
  );
}

const count = (rows: PreviewRow[]) => ({ new: rows.filter((r) => r.status === "new").length, duplicate: rows.filter((r) => r.status === "duplicate").length, invalid: rows.filter((r) => r.status === "invalid").length });

/** CSV export of the filtered list (same query parameters as the list pages), up to 10,000 rows. */
export async function exportCsv(ctx: RequestContext, organizationId: string, companyId: string, entity: CsvEntity, query: Record<string, string | string[] | undefined>) {
  const all = { ...query, page: "1" };
  if (entity === "leads") {
    const rows = await listLeads(ctx, organizationId, companyId, parseLeadFilters(query), { take: 10_000 });
    return toCsv(
      ["Name", "Email", "Phone", "Company", "Source", "Stage", "Score", "Temperature", "Owner", "Value", "Currency", "Probability", "Expected close", "Territory", "Qualified", "Converted", "Tags", "Created"],
      rows.map((l) => [l.name, l.email, l.phone, l.account, l.source, l.stage, l.score, l.scoreLabel, l.owner?.name, toMajor(l.valueMinor, l.currency), l.currency, l.probability, isoDay(l.expectedCloseDate), l.territory, l.qualified ? "yes" : "no", l.convertedAt ? "yes" : "no", l.tags.join("|"), isoDay(l.createdAt)]),
    );
  }
  if (entity === "contacts") {
    const { rows } = await listContacts(ctx, organizationId, companyId, { ...parseContactFilters(all), page: 1 }, { take: 10_000 });
    return toCsv(
      ["First name", "Last name", "Email", "Phone", "Title", "Company", "Owner", "Marketing consent", "Tags", "Created"],
      rows.map((c) => [c.firstName, c.lastName, c.email, c.phone, c.title, c.account?.name, c.owner?.name, c.marketingConsent ? "yes" : "no", c.tags.join("|"), isoDay(c.createdAt)]),
    );
  }
  if (entity === "accounts") {
    const { rows } = await listAccounts(ctx, organizationId, companyId, { ...parseAccountFilters(all), page: 1 }, { take: 10_000 });
    return toCsv(
      ["Name", "Type", "Domain", "Website", "Industry", "Email", "Phone", "Country", "Territory", "Source", "Owner", "Contacts", "Open deals", "Tags", "Created"],
      rows.map((a) => [a.name, a.type, a.domain, a.website, a.industry, a.email, a.phone, a.countryCode, a.territory, a.source, a.owner?.name, a._count.contacts, a._count.crmDeals, a.tags.join("|"), isoDay(a.createdAt)]),
    );
  }
  const { rows } = await listDeals(ctx, organizationId, companyId, { ...parseDealFilters(all), page: 1 }, { take: 10_000 });
  return toCsv(
    ["Name", "Account", "Contact", "Pipeline", "Stage", "Status", "Amount", "Currency", "Probability", "Weighted", "Expected close", "Owner", "Source", "Campaign", "Lost reason", "Tags", "Created", "Closed"],
    rows.map((d) => [
      d.name,
      d.account?.name,
      d.contact ? contactName(d.contact) : null,
      d.pipeline.name,
      d.stage.name,
      d.status,
      toMajor(d.amountMinor, d.currency),
      d.currency,
      d.effectiveProbability,
      toMajor(d.weightedMinor, d.currency),
      isoDay(d.expectedCloseDate),
      d.ownerName,
      d.source,
      d.campaignCode,
      d.lostReason,
      d.tags.join("|"),
      isoDay(d.createdAt),
      isoDay(d.closedAt),
    ]),
  );
}

