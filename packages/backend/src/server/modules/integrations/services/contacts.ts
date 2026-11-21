import "server-only";
import { db } from "@/server/core/db";
import { providerFetch } from "../client";
import type { Connection } from "../connections";
import { recordUsage } from "../usage";
import { ensureOk, errorText, withFallback, type ProviderAttempt, type ServiceResult } from "./common";

/**
 * Contact data for prospecting (B2B): find decision makers at a company domain, find and verify a work email, enrich a
 * person or a company. Providers (API keys through Integrations): Apollo.io, Hunter.io, People Data Labs.
 *
 * Every value is returned exactly as the provider sent it; nothing is guessed or pattern-generated. An email is
 * VERIFIED only when a provider said it is deliverable (Hunter verifier "valid", Apollo email_status "verified");
 * otherwise it stays UNVERIFIED / RISKY / INVALID. Every call is metered (usage + estimated cost, list prices) and
 * rate-limited per connection (client.ts PROVIDER_RATE_LIMITS); unconnected providers are skipped and errors fall
 * through to the next provider in the order.
 */

export const CONTACT_PROVIDERS = ["apollo", "hunter", "pdl"] as const;
export type ContactProvider = (typeof CONTACT_PROVIDERS)[number];
export const isContactProvider = (v: string): v is ContactProvider => (CONTACT_PROVIDERS as readonly string[]).includes(v);

/** Default fallback order per operation (a provider with no data falls through to the next one). */
export const DEFAULT_ORDER = {
  people: ["apollo", "pdl", "hunter"],
  email: ["hunter", "apollo", "pdl"],
  person: ["apollo", "pdl", "hunter"],
  company: ["apollo", "pdl", "hunter"],
} as const satisfies Record<string, readonly ContactProvider[]>;

/** Canonical seniorities (Apollo's vocabulary), mapped to Hunter and PDL below. */
export const SENIORITIES = ["owner", "founder", "c_suite", "partner", "vp", "head", "director", "manager", "senior", "entry"] as const;
export type Seniority = (typeof SENIORITIES)[number];

const HUNTER_SENIORITY: Record<Seniority, "executive" | "senior" | "junior"> = {
  owner: "executive",
  founder: "executive",
  c_suite: "executive",
  partner: "executive",
  vp: "executive",
  head: "senior",
  director: "senior",
  manager: "senior",
  senior: "senior",
  entry: "junior",
};
const PDL_LEVEL: Record<Seniority, string> = { owner: "owner", founder: "owner", c_suite: "cxo", partner: "partner", vp: "vp", head: "director", director: "director", manager: "manager", senior: "senior", entry: "entry" };

/** Estimated list price per call in micro-USD (shown as estimates; the provider's invoice is authoritative). */
const COST_MICROS: Record<string, number> = {
  "apollo.people_search": 0, // People API Search does not use credits.
  "apollo.match": 30_000,
  "apollo.company": 30_000,
  "hunter.domain_search": 24_500,
  "hunter.email_find": 24_500,
  "hunter.email_verify": 12_250,
  "hunter.person": 24_500,
  "hunter.company": 24_500,
  "pdl.person_record": 280_000,
  "pdl.company": 100_000,
};

export type EmailVerdict = "VERIFIED" | "RISKY" | "UNVERIFIED" | "INVALID" | "NONE";

export interface FoundPerson {
  firstName: string | null;
  lastName: string | null;
  fullName: string;
  title: string | null;
  seniority: string | null;
  linkedinUrl: string | null;
  location: string | null;
  companyName: string | null;
  domain: string;
  email: string | null;
  emailStatus: EmailVerdict;
  /** Provider that supplied the address (null when none). */
  emailSource: string | null;
  sourceProvider: ContactProvider;
  externalId: string | null;
  verification: Record<string, unknown>;
}

export interface EmailFinding {
  email: string | null;
  status: EmailVerdict;
  source: ContactProvider;
  score: number | null;
  detail: Record<string, unknown>;
}

export interface EmailVerification {
  email: string;
  status: EmailVerdict;
  verifier: ContactProvider;
  detail: Record<string, unknown>;
}

export interface PersonProfile {
  fullName: string | null;
  title: string | null;
  seniority: string | null;
  email: string | null;
  emailStatus: EmailVerdict;
  linkedinUrl: string | null;
  location: string | null;
  companyName: string | null;
  domain: string | null;
  provider: ContactProvider;
}

export interface CompanyProfile {
  name: string | null;
  domain: string;
  industry: string | null;
  employees: number | null;
  location: string | null;
  description: string | null;
  linkedinUrl: string | null;
  foundedYear: number | null;
  provider: ContactProvider;
}

type Conn = Connection & { accessToken: string };

// ─── helpers ────────────────────────────────────────────────────────────────────────────────────────────────────────

const DOMAIN_RE = /^(?=.{3,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const EMAIL_RE = /^[^\s@]{1,64}@[a-z0-9.-]{3,253}\.[a-z]{2,63}$/i;

/** "https://www.Acme.com/about" → "acme.com"; null when it is not a plausible domain. */
export function cleanDomain(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let v = raw.trim().toLowerCase();
  try {
    if (/^[a-z]+:\/\//.test(v)) v = new URL(v).hostname;
  } catch {
    return null;
  }
  v = v.replace(/^www\./, "").replace(/\/.*$/, "").replace(/\.$/, "");
  return DOMAIN_RE.test(v) ? v : null;
}

/** A real address as returned by a provider, lower-cased; placeholders ("email_not_unlocked@…") and booleans → null. */
export function cleanEmail(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const e = v.trim().toLowerCase();
  if (!EMAIL_RE.test(e) || /not_unlocked|^email_not|@domain\.com$/.test(e)) return null;
  return e;
}

const s = (v: unknown, max = 200) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const joinName = (first: string | null, last: string | null) => [first, last].filter(Boolean).join(" ").trim();

/** Hunter verifier / finder status → verdict. */
function hunterVerdict(status: unknown): EmailVerdict {
  switch (status) {
    case "valid":
      return "VERIFIED";
    case "invalid":
    case "disposable":
      return "INVALID";
    case "accept_all":
    case "webmail":
    case "unknown":
      return "RISKY";
    default:
      return "UNVERIFIED";
  }
}

/** Apollo email_status → verdict ("verified" only counts as verified). */
function apolloVerdict(status: unknown, email: string | null): EmailVerdict {
  if (!email) return "NONE";
  if (status === "verified") return "VERIFIED";
  if (status === "unavailable" || status === "bounced") return "INVALID";
  return "UNVERIFIED";
}

async function meter(organizationId: string, companyId: string, conn: Conn, operation: string, status: "SUCCEEDED" | "FAILED", costKey: string | null, units = 1, error?: string, meta?: Record<string, unknown>) {
  await recordUsage({
    organizationId,
    companyId,
    connectionId: conn.id,
    provider: conn.provider,
    operation,
    units,
    unit: "request",
    status,
    error,
    estimatedCostMicros: status !== "SUCCEEDED" || !costKey ? 0 : COST_MICROS[costKey] === undefined ? null : COST_MICROS[costKey] * Math.max(1, units),
    meta,
  });
}

/** Run one metered call; failures are metered and rethrown (so the fallback chain moves on). */
async function metered<T>(organizationId: string, companyId: string, conn: Conn, operation: string, fn: () => Promise<{ data: T; costKey: string | null; units?: number }>): Promise<T> {
  try {
    const r = await fn();
    await meter(organizationId, companyId, conn, operation, "SUCCEEDED", r.costKey, r.units ?? 1);
    return r.data;
  } catch (err) {
    await meter(organizationId, companyId, conn, operation, "FAILED", null, 1, errorText(err));
    throw err;
  }
}

const hunterUrl = (conn: Conn, path: string, params: Record<string, string>) => `https://api.hunter.io/v2/${path}?${new URLSearchParams({ ...params, api_key: conn.accessToken })}`;

/**
 * Try providers in `order`; a provider that answers with no data falls through to the next one. Returns the first
 * non-empty answer, or an empty `ok` when every connected provider answered without data.
 */
async function firstWithData<T>(organizationId: string, companyId: string, order: readonly ContactProvider[], empty: (d: T) => boolean, run: (conn: Conn) => Promise<T>): Promise<ServiceResult<T>> {
  const attempts: ProviderAttempt[] = [];
  let emptyOk: { data: T; providerId: string } | null = null;
  let lastFail: Extract<ServiceResult<T>, { ok: false }> | null = null;
  for (const p of order) {
    const r = await withFallback(organizationId, companyId, [p], run);
    attempts.push(...r.attempts);
    if (r.ok) {
      if (!empty(r.data)) return { ...r, attempts };
      emptyOk ??= { data: r.data, providerId: r.providerId };
    } else if (r.code !== "not_connected") {
      lastFail = r;
    }
  }
  if (emptyOk) return { ok: true, data: emptyOk.data, providerId: emptyOk.providerId, attempts };
  if (lastFail) return { ...lastFail, attempts };
  return { ok: false, code: "not_connected", error: `No contact-data provider connected (connect one of: ${order.join(", ")})`, providerId: null, attempts };
}

function orderOf(kind: keyof typeof DEFAULT_ORDER, preferred?: readonly string[]): ContactProvider[] {
  const pref = (preferred ?? []).filter(isContactProvider);
  const base = DEFAULT_ORDER[kind] as readonly ContactProvider[];
  // The preferred order first, then the remaining defaults (a provider that cannot do an operation is skipped there).
  return [...new Set([...pref.filter((p) => base.includes(p)), ...base])];
}

// ─── Find people at a company ─────────────────────────────────────────────────────────────────────────────────────

export interface FindPeopleInput {
  domain: string;
  /** Job titles to look for ("Owner", "Head of Sales"). */
  titles?: string[];
  seniorities?: Seniority[];
  limit?: number;
  providers?: readonly string[];
}

export async function findPeople(organizationId: string, companyId: string, input: FindPeopleInput): Promise<ServiceResult<{ people: FoundPerson[] }>> {
  const domain = cleanDomain(input.domain);
  if (!domain) return { ok: false, code: "invalid_input", error: "Not a valid company domain", providerId: null, attempts: [] };
  const limit = Math.min(Math.max(1, Math.floor(input.limit ?? 5)), 25);
  const titles = (input.titles ?? []).map((t) => t.trim()).filter(Boolean).slice(0, 10);
  const seniorities = (input.seniorities ?? []).filter((x): x is Seniority => (SENIORITIES as readonly string[]).includes(x));
  return firstWithData(organizationId, companyId, orderOf("people", input.providers), (d) => !d.people.length, async (conn) => {
    if (conn.provider === "apollo") {
      return metered(organizationId, companyId, conn, "contacts.people_search", async () => {
        const res = await providerFetch<{ people?: Record<string, unknown>[] }>(conn, "https://api.apollo.io/api/v1/mixed_people/api_search", {
          json: { q_organization_domains_list: [domain], ...(titles.length ? { person_titles: titles, include_similar_titles: true } : {}), ...(seniorities.length ? { person_seniorities: seniorities } : {}), page: 1, per_page: limit },
          retries: 1,
        });
        ensureOk(res, "Apollo people search");
        const people = (res.data?.people ?? []).slice(0, limit).map((p): FoundPerson => {
          const org = (p.organization ?? {}) as Record<string, unknown>;
          const first = s(p.first_name, 80);
          // People API Search may hide the last name (last_name_obfuscated); it is filled in by enrichment, never guessed.
          const last = s(p.last_name, 80);
          const email = cleanEmail(p.email);
          return {
            firstName: first,
            lastName: last,
            fullName: s(p.name, 160) ?? (joinName(first, last) || first || "—"),
            title: s(p.title),
            seniority: s(p.seniority, 40),
            linkedinUrl: s(p.linkedin_url, 300),
            location: [s(p.city, 80), s(p.country, 80)].filter(Boolean).join(", ") || null,
            companyName: s(org.name),
            domain,
            email,
            emailStatus: apolloVerdict(p.email_status, email),
            emailSource: email ? "apollo" : null,
            sourceProvider: "apollo",
            externalId: s(p.id, 64),
            verification: email ? { provider: "apollo", email_status: p.email_status ?? null } : {},
          };
        });
        return { data: { people }, costKey: "apollo.people_search" };
      });
    }
    if (conn.provider === "hunter") {
      return metered(organizationId, companyId, conn, "contacts.people_search", async () => {
        const hs = [...new Set(seniorities.map((x) => HUNTER_SENIORITY[x]))];
        const res = await providerFetch<{ data?: { organization?: string; emails?: Record<string, unknown>[] } }>(
          conn,
          hunterUrl(conn, "domain-search", { domain, limit: String(Math.min(limit * 3, 100)), type: "personal", ...(hs.length ? { seniority: hs.join(",") } : {}) }),
          { retries: 1, noAuth: true },
        );
        ensureOk(res, "Hunter domain search");
        const want = titles.map((t) => t.toLowerCase());
        const rows = (res.data?.data?.emails ?? []).filter((e) => {
          if (!want.length) return true;
          const pos = String(e.position ?? "").toLowerCase();
          return want.some((w) => pos.includes(w) || w.split(/\s+/).every((part) => pos.includes(part)));
        });
        const people = rows.slice(0, limit).flatMap((e): FoundPerson[] => {
          const first = s(e.first_name, 80);
          const last = s(e.last_name, 80);
          const name = joinName(first, last);
          if (!name) return []; // an address without a person is not a decision maker
          const email = cleanEmail(e.value);
          const v = (e.verification ?? {}) as Record<string, unknown>;
          return [
            {
              firstName: first,
              lastName: last,
              fullName: name,
              title: s(e.position),
              seniority: s(e.seniority, 40),
              linkedinUrl: s(e.linkedin, 300),
              location: null,
              companyName: s(res.data?.data?.organization),
              domain,
              email,
              // Found on the web; counts as verified only when Hunter's own check said "valid".
              emailStatus: email ? (v.status === "valid" ? "VERIFIED" : v.status ? hunterVerdict(v.status) : "UNVERIFIED") : "NONE",
              emailSource: email ? "hunter" : null,
              sourceProvider: "hunter",
              externalId: null,
              verification: email ? { provider: "hunter", confidence: n(e.confidence), status: v.status ?? null, date: v.date ?? null } : {},
            },
          ];
        });
        return { data: { people }, costKey: rows.length ? "hunter.domain_search" : null };
      });
    }
    // People Data Labs (Elasticsearch query); 404 means no match.
    return metered(organizationId, companyId, conn, "contacts.people_search", async () => {
      const must: Record<string, unknown>[] = [{ term: { job_company_website: domain } }];
      const levels = [...new Set(seniorities.map((x) => PDL_LEVEL[x]))];
      if (levels.length) must.push({ terms: { job_title_levels: levels } });
      if (titles.length) must.push({ bool: { should: titles.map((t) => ({ match: { job_title: t } })) } });
      const res = await providerFetch<{ data?: Record<string, unknown>[] }>(conn, "https://api.peopledatalabs.com/v5/person/search", { json: { query: { bool: { must } }, size: limit }, retries: 1 });
      if (res.status === 404) return { data: { people: [] }, costKey: null };
      ensureOk(res, "People Data Labs search");
      const people = (res.data?.data ?? []).slice(0, limit).flatMap((p): FoundPerson[] => {
        const first = s(p.first_name, 80);
        const last = s(p.last_name, 80);
        const name = s(p.full_name, 160) ?? joinName(first, last);
        if (!name) return [];
        const email = cleanEmail(p.work_email);
        return [
          {
            firstName: first,
            lastName: last,
            fullName: name.replace(/\b\w/g, (c) => c.toUpperCase()),
            title: s(p.job_title),
            seniority: Array.isArray(p.job_title_levels) ? s(p.job_title_levels[0], 40) : null,
            linkedinUrl: s(p.linkedin_url, 300) ? `https://${String(p.linkedin_url).replace(/^https?:\/\//, "")}` : null,
            location: s(p.location_name),
            companyName: s(p.job_company_name),
            domain,
            email,
            emailStatus: email ? "UNVERIFIED" : "NONE",
            emailSource: email ? "pdl" : null,
            sourceProvider: "pdl",
            externalId: s(p.id, 64),
            verification: {},
          },
        ];
      });
      return { data: { people }, costKey: people.length ? "pdl.person_record" : null, units: Math.max(1, people.length) };
    });
  });
}

// ─── Find / verify an email ─────────────────────────────────────────────────────────────────────────────────────────

export interface FindEmailInput {
  firstName: string;
  lastName: string;
  domain: string;
  /** Provider id of the person (Apollo id), when known. */
  apolloId?: string | null;
  providers?: readonly string[];
}

export async function findEmail(organizationId: string, companyId: string, input: FindEmailInput): Promise<ServiceResult<EmailFinding>> {
  const domain = cleanDomain(input.domain);
  const first = input.firstName.trim().slice(0, 80);
  const last = input.lastName.trim().slice(0, 80);
  if (!domain || !first || (!last && !input.apolloId)) return { ok: false, code: "invalid_input", error: "A first name, last name and company domain are needed", providerId: null, attempts: [] };
  return firstWithData(organizationId, companyId, orderOf("email", input.providers), (d) => !d.email, async (conn): Promise<EmailFinding> => {
    if (conn.provider === "hunter") {
      if (!last) return { email: null, status: "NONE", source: "hunter", score: null, detail: {} };
      return metered<EmailFinding>(organizationId, companyId, conn, "contacts.email_find", async () => {
        const res = await providerFetch<{ data?: Record<string, unknown> }>(conn, hunterUrl(conn, "email-finder", { domain, first_name: first, last_name: last }), { retries: 1, noAuth: true });
        if (res.status === 404) return { data: { email: null, status: "NONE" as const, source: "hunter" as const, score: null, detail: {} }, costKey: null };
        ensureOk(res, "Hunter email finder");
        const d = res.data?.data ?? {};
        const email = cleanEmail(d.email);
        const v = (d.verification ?? {}) as Record<string, unknown>;
        return {
          data: { email, status: email ? (v.status ? hunterVerdict(v.status) : "UNVERIFIED") : "NONE", source: "hunter" as const, score: n(d.score), detail: { provider: "hunter", score: n(d.score), status: v.status ?? null, date: v.date ?? null } },
          costKey: email ? "hunter.email_find" : null,
        };
      });
    }
    if (conn.provider === "apollo") {
      return metered<EmailFinding>(organizationId, companyId, conn, "contacts.email_find", async () => {
        const res = await providerFetch<{ person?: Record<string, unknown> }>(conn, "https://api.apollo.io/api/v1/people/match", {
          json: { ...(input.apolloId ? { id: input.apolloId } : {}), first_name: first, ...(last ? { last_name: last } : {}), domain, reveal_personal_emails: false, reveal_phone_number: false },
          retries: 1,
        });
        if (res.status === 404) return { data: { email: null, status: "NONE" as const, source: "apollo" as const, score: null, detail: {} }, costKey: null };
        ensureOk(res, "Apollo people match");
        const p = res.data?.person ?? {};
        const email = cleanEmail(p.email);
        // Only an address at the target company's domain counts (a match at another employer is a different person's job).
        const atDomain = email && email.endsWith(`@${domain}`) ? email : null;
        return {
          data: {
            email: atDomain,
            status: apolloVerdict(p.email_status, atDomain),
            source: "apollo" as const,
            score: null,
            detail: { provider: "apollo", email_status: p.email_status ?? null, name: s(p.name, 160), last_name: s(p.last_name, 80), title: s(p.title), linkedin_url: s(p.linkedin_url, 300) },
          },
          costKey: "apollo.match",
        };
      });
    }
    return metered<EmailFinding>(organizationId, companyId, conn, "contacts.email_find", async () => {
      if (!last) return { data: { email: null, status: "NONE" as const, source: "pdl" as const, score: null, detail: {} }, costKey: null };
      const res = await providerFetch<{ data?: Record<string, unknown>; likelihood?: number }>(conn, `https://api.peopledatalabs.com/v5/person/enrich?${new URLSearchParams({ first_name: first, last_name: last, company: domain, min_likelihood: "6" })}`, { retries: 1 });
      if (res.status === 404) return { data: { email: null, status: "NONE" as const, source: "pdl" as const, score: null, detail: {} }, costKey: null };
      ensureOk(res, "People Data Labs enrich");
      const email = cleanEmail(res.data?.data?.work_email);
      const atDomain = email && email.endsWith(`@${domain}`) ? email : null;
      return { data: { email: atDomain, status: atDomain ? "UNVERIFIED" as const : "NONE" as const, source: "pdl" as const, score: n(res.data?.likelihood), detail: { provider: "pdl", likelihood: n(res.data?.likelihood) } }, costKey: "pdl.person_record" };
    });
  });
}

/** Deliverability check (Hunter email verifier). A 202 "still checking" answer is UNVERIFIED, never assumed valid. */
export async function verifyEmail(organizationId: string, companyId: string, email: string): Promise<ServiceResult<EmailVerification>> {
  const e = cleanEmail(email);
  if (!e) return { ok: false, code: "invalid_input", error: "Not a valid email address", providerId: null, attempts: [] };
  return withFallback(organizationId, companyId, ["hunter"], async (conn) =>
    metered<EmailVerification>(organizationId, companyId, conn, "contacts.email_verify", async () => {
      const res = await providerFetch<{ data?: Record<string, unknown> }>(conn, hunterUrl(conn, "email-verifier", { email: e }), { retries: 1, noAuth: true, timeoutMs: 25_000 });
      if (res.status === 202) return { data: { email: e, status: "UNVERIFIED" as const, verifier: "hunter" as const, detail: { provider: "hunter", pending: true } }, costKey: null };
      ensureOk(res, "Hunter email verifier");
      const d = res.data?.data ?? {};
      return {
        data: { email: e, status: hunterVerdict(d.status), verifier: "hunter" as const, detail: { provider: "hunter", status: d.status ?? null, result: d.result ?? null, score: n(d.score), accept_all: d.accept_all ?? null, disposable: d.disposable ?? null, webmail: d.webmail ?? null } },
        costKey: "hunter.email_verify",
      };
    }),
  );
}

// ─── Enrichment ─────────────────────────────────────────────────────────────────────────────────────────────────────

export async function enrichPerson(organizationId: string, companyId: string, input: { email?: string; firstName?: string; lastName?: string; domain?: string; providers?: readonly string[] }): Promise<ServiceResult<PersonProfile | null>> {
  const email = cleanEmail(input.email);
  const domain = cleanDomain(input.domain);
  const first = input.firstName?.trim().slice(0, 80) ?? "";
  const last = input.lastName?.trim().slice(0, 80) ?? "";
  if (!email && !(first && last && domain)) return { ok: false, code: "invalid_input", error: "An email, or a name and company domain, is needed", providerId: null, attempts: [] };
  return firstWithData(organizationId, companyId, orderOf("person", input.providers), (d) => !d, async (conn): Promise<PersonProfile | null> => {
    if (conn.provider === "apollo") {
      return metered(organizationId, companyId, conn, "contacts.enrich_person", async () => {
        const res = await providerFetch<{ person?: Record<string, unknown> }>(conn, "https://api.apollo.io/api/v1/people/match", {
          json: { ...(email ? { email } : { first_name: first, last_name: last, domain }), reveal_personal_emails: false, reveal_phone_number: false },
          retries: 1,
        });
        if (res.status === 404) return { data: null, costKey: null };
        ensureOk(res, "Apollo people match");
        const p = res.data?.person;
        if (!p) return { data: null, costKey: null };
        const org = (p.organization ?? {}) as Record<string, unknown>;
        const em = cleanEmail(p.email);
        return {
          data: { fullName: s(p.name, 160), title: s(p.title), seniority: s(p.seniority, 40), email: em, emailStatus: apolloVerdict(p.email_status, em), linkedinUrl: s(p.linkedin_url, 300), location: [s(p.city, 80), s(p.country, 80)].filter(Boolean).join(", ") || null, companyName: s(org.name), domain: cleanDomain(s(org.primary_domain) ?? s(org.website_url)), provider: "apollo" as const },
          costKey: "apollo.match",
        };
      });
    }
    if (conn.provider === "hunter") {
      if (!email) return null;
      return metered(organizationId, companyId, conn, "contacts.enrich_person", async () => {
        const res = await providerFetch<{ data?: { person?: Record<string, unknown>; company?: Record<string, unknown> } }>(conn, hunterUrl(conn, "combined/find", { email }), { retries: 1, noAuth: true });
        if (res.status === 404) return { data: null, costKey: null };
        ensureOk(res, "Hunter enrichment");
        const p = res.data?.data?.person ?? {};
        const c = res.data?.data?.company ?? {};
        const name = (p.name ?? {}) as Record<string, unknown>;
        const emp = (p.employment ?? {}) as Record<string, unknown>;
        const geo = (p.geo ?? {}) as Record<string, unknown>;
        const li = (p.linkedin ?? {}) as Record<string, unknown>;
        return {
          data: { fullName: s(name.fullName, 160), title: s(emp.title), seniority: s(emp.seniority, 40), email, emailStatus: "UNVERIFIED" as const, linkedinUrl: s(li.handle) ? `https://www.linkedin.com/${String(li.handle).replace(/^\/+/, "")}` : null, location: s(geo.city) ?? s(geo.country), companyName: s(c.name) ?? s(emp.name), domain: cleanDomain(s(c.domain) ?? s(emp.domain)), provider: "hunter" as const },
          costKey: "hunter.person",
        };
      });
    }
    return metered(organizationId, companyId, conn, "contacts.enrich_person", async () => {
      const q: Record<string, string> = email ? { email } : { first_name: first, last_name: last, company: domain! };
      const res = await providerFetch<{ data?: Record<string, unknown> }>(conn, `https://api.peopledatalabs.com/v5/person/enrich?${new URLSearchParams({ ...q, min_likelihood: "6" })}`, { retries: 1 });
      if (res.status === 404) return { data: null, costKey: null };
      ensureOk(res, "People Data Labs enrich");
      const p = res.data?.data ?? {};
      const em = cleanEmail(p.work_email);
      return {
        data: { fullName: s(p.full_name, 160), title: s(p.job_title), seniority: Array.isArray(p.job_title_levels) ? s(p.job_title_levels[0], 40) : null, email: em, emailStatus: em ? ("UNVERIFIED" as const) : ("NONE" as const), linkedinUrl: s(p.linkedin_url, 300), location: s(p.location_name), companyName: s(p.job_company_name), domain: cleanDomain(s(p.job_company_website)), provider: "pdl" as const },
        costKey: "pdl.person_record",
      };
    });
  });
}

export async function enrichCompany(organizationId: string, companyId: string, rawDomain: string, opts: { providers?: readonly string[] } = {}): Promise<ServiceResult<CompanyProfile | null>> {
  const domain = cleanDomain(rawDomain);
  if (!domain) return { ok: false, code: "invalid_input", error: "Not a valid company domain", providerId: null, attempts: [] };
  return firstWithData(organizationId, companyId, orderOf("company", opts.providers), (d) => !d, async (conn): Promise<CompanyProfile | null> => {
    if (conn.provider === "apollo") {
      return metered(organizationId, companyId, conn, "contacts.enrich_company", async () => {
        const res = await providerFetch<{ organization?: Record<string, unknown> }>(conn, `https://api.apollo.io/api/v1/organizations/enrich?${new URLSearchParams({ domain })}`, { retries: 1 });
        if (res.status === 404) return { data: null, costKey: null };
        ensureOk(res, "Apollo organization enrichment");
        const o = res.data?.organization;
        if (!o) return { data: null, costKey: null };
        return {
          data: { name: s(o.name), domain, industry: s(o.industry), employees: n(o.estimated_num_employees), location: [s(o.city, 80), s(o.country, 80)].filter(Boolean).join(", ") || null, description: s(o.short_description, 1000), linkedinUrl: s(o.linkedin_url, 300), foundedYear: n(o.founded_year), provider: "apollo" as const },
          costKey: "apollo.company",
        };
      });
    }
    if (conn.provider === "hunter") {
      return metered(organizationId, companyId, conn, "contacts.enrich_company", async () => {
        const res = await providerFetch<{ data?: Record<string, unknown> }>(conn, hunterUrl(conn, "companies/find", { domain }), { retries: 1, noAuth: true });
        if (res.status === 404) return { data: null, costKey: null };
        ensureOk(res, "Hunter company enrichment");
        const c = res.data?.data ?? {};
        const cat = (c.category ?? {}) as Record<string, unknown>;
        const geo = (c.geo ?? {}) as Record<string, unknown>;
        const metrics = (c.metrics ?? {}) as Record<string, unknown>;
        const li = (c.linkedin ?? {}) as Record<string, unknown>;
        return {
          data: { name: s(c.name), domain, industry: s(cat.industry), employees: n(metrics.employees), location: [s(geo.city, 80), s(geo.country, 80)].filter(Boolean).join(", ") || null, description: s(c.description, 1000), linkedinUrl: s(li.handle) ? `https://www.linkedin.com/${String(li.handle).replace(/^\/+/, "")}` : null, foundedYear: n(c.foundedYear), provider: "hunter" as const },
          costKey: "hunter.company",
        };
      });
    }
    return metered(organizationId, companyId, conn, "contacts.enrich_company", async () => {
      const res = await providerFetch<Record<string, unknown>>(conn, `https://api.peopledatalabs.com/v5/company/enrich?${new URLSearchParams({ website: domain })}`, { retries: 1 });
      if (res.status === 404) return { data: null, costKey: null };
      ensureOk(res, "People Data Labs company enrich");
      const c = res.data ?? {};
      const loc = (c.location ?? {}) as Record<string, unknown>;
      return {
        data: { name: s(c.display_name) ?? s(c.name), domain, industry: s(c.industry), employees: n(c.employee_count), location: s(loc.name), description: s(c.summary, 1000), linkedinUrl: s(c.linkedin_url, 300) ? `https://${String(c.linkedin_url).replace(/^https?:\/\//, "")}` : null, foundedYear: n(c.founded), provider: "pdl" as const },
        costKey: "pdl.company",
      };
    });
  });
}

// ─── Status ─────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface ContactProviderStatus {
  provider: ContactProvider;
  connected: boolean;
  status: "CONNECTED" | "ERROR" | "DISCONNECTED" | "NOT_CONNECTED";
  account: string | null;
  lastError: string | null;
  calls30d: number;
  failed30d: number;
  /** Estimated cost of the last 30 days in micro-USD (null when nothing was priced). */
  costMicros30d: number | null;
}

/** Connection state + 30-day usage of the contact-data providers (for status panels). */
export async function contactProviderStatus(organizationId: string, companyId: string): Promise<ContactProviderStatus[]> {
  const since = new Date(Date.now() - 30 * 86_400_000);
  const [conns, usage] = await Promise.all([
    db().integrationConnection.findMany({ where: { organizationId, companyId, provider: { in: [...CONTACT_PROVIDERS] } }, select: { provider: true, status: true, externalAccount: true, lastError: true, credentialsEnc: true } }),
    db().integrationUsage.groupBy({ by: ["provider", "status"], where: { organizationId, companyId, provider: { in: [...CONTACT_PROVIDERS] }, createdAt: { gte: since } }, _count: { _all: true }, _sum: { estimatedCostMicros: true } }),
  ]);
  return CONTACT_PROVIDERS.map((p) => {
    const c = conns.find((x) => x.provider === p);
    const u = usage.filter((x) => x.provider === p);
    const priced = u.map((x) => x._sum.estimatedCostMicros).filter((v): v is number => typeof v === "number");
    const connected = !!c && c.status !== "DISCONNECTED" && !!c.credentialsEnc;
    return {
      provider: p,
      connected,
      status: c ? (c.status as ContactProviderStatus["status"]) : "NOT_CONNECTED",
      account: c?.externalAccount ?? null,
      lastError: c?.status === "ERROR" ? (c.lastError ?? null) : null,
      calls30d: u.reduce((a, x) => a + x._count._all, 0),
      failed30d: u.filter((x) => x.status === "FAILED").reduce((a, x) => a + x._count._all, 0),
      costMicros30d: priced.length ? priced.reduce((a, v) => a + v, 0) : null,
    };
  });
}

/** Which contact-data providers are usable right now (connected, credentials present). */
export async function connectedContactProviders(organizationId: string, companyId: string): Promise<ContactProvider[]> {
  const rows = await db().integrationConnection.findMany({ where: { organizationId, companyId, provider: { in: [...CONTACT_PROVIDERS] }, status: { not: "DISCONNECTED" }, credentialsEnc: { not: null } }, select: { provider: true } });
  return CONTACT_PROVIDERS.filter((p) => rows.some((r) => r.provider === p));
}

