import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/core/db";
import { acceptInvitation, createOrganization, inviteMember } from "@/server/modules/organizations/service";
import { createCompany } from "@/server/modules/companies/service";
import { systemRoleId } from "@/server/modules/rbac/service";
import { createSession, SESSION_COOKIE } from "@/server/modules/auth/session";
import { deleteDocument, getDocument, ingestDocument, listDocuments, searchDocuments } from "@/server/modules/brain/service";
import { GET as listRoute, POST as ingestRoute } from "@/app/api/v1/organizations/[orgId]/companies/[companyId]/brain/documents/route";
import { GET as documentRoute } from "@/app/api/v1/organizations/[orgId]/companies/[companyId]/brain/documents/[documentId]/route";
import { GET as searchRoute } from "@/app/api/v1/organizations/[orgId]/companies/[companyId]/brain/search/route";
import { expectCode, makeUser, resetDb } from "../helpers";
import { params, req } from "../http";

beforeAll(resetDb);

const POLICY = `# Refund policy

Customers may request a full refund within 30 days of purchase. Refunds are issued to the original payment method.

## Exceptions

Enterprise contracts follow the cancellation terms in their order form.`;

const PLAN = "Launch plan\n\nWe launch in the United Arab Emirates first, then expand to India and the United States.";

async function setup() {
  const owner = await makeUser({ name: "Owner" });
  const org = await createOrganization(owner.ctx, { name: `Brain ${Math.random()}` });
  const company = await createCompany(owner.ctx, org.id, { name: "Brain Co", incorporationCountryCode: "US" });
  return { owner, org, company };
}

async function joinAs(ownerCtx: Parameters<typeof inviteMember>[0], orgId: string, companyId: string, roleKey: string) {
  const u = await makeUser();
  const { token } = await inviteMember(ownerCtx, orgId, { email: u.user.email, roleId: await systemRoleId(db(), roleKey), scopeType: "COMPANY", scopeId: companyId });
  await acceptInvitation(u.ctx, token);
  return u;
}

describe("company brain", () => {
  it("ingests Markdown and text into indexed passages, audited", async () => {
    const { owner, org, company } = await setup();
    const doc = await ingestDocument(owner.ctx, org.id, company.id, { filename: "refund-policy.md", content: POLICY });
    expect(doc).toMatchObject({ title: "refund-policy", filename: "refund-policy.md", mimeType: "text/markdown", status: "READY", passages: 1, sizeBytes: Buffer.byteLength(POLICY) });
    const pasted = await ingestDocument(owner.ctx, org.id, company.id, { content: PLAN });
    expect(pasted).toMatchObject({ title: "Launch plan", filename: null, mimeType: "text/plain" });

    const full = await getDocument(owner.ctx, org.id, company.id, doc.id);
    expect(full.passages.map((p) => p.text).join("")).toBe(POLICY);
    expect((await listDocuments(owner.ctx, org.id, company.id)).data.map((d) => d.id)).toEqual([pasted.id, doc.id]);
    expect(await db().auditLog.count({ where: { organizationId: org.id, action: "brain.document.created" } })).toBe(2);
  });

  it("returns cited passages from real documents, with highlights and stemming", async () => {
    const { owner, org, company } = await setup();
    const doc = await ingestDocument(owner.ctx, org.id, company.id, { filename: "policy.md", content: POLICY });
    await ingestDocument(owner.ctx, org.id, company.id, { filename: "plan.txt", content: PLAN });
    const long = Array.from({ length: 30 }, (_, i) => `Section ${i}. ${"Operations and logistics notes. ".repeat(12)}`).join("\n\n") + "\n\nThe warehouse in Dubai ships every Tuesday.";
    const big = await ingestDocument(owner.ctx, org.id, company.id, { filename: "ops.txt", content: long });
    expect(big.passages).toBeGreaterThan(3);

    const { results } = await searchDocuments(owner.ctx, org.id, company.id, { q: "refunds" }); // stems to "refund"
    expect(results).toHaveLength(1);
    expect(results[0]!.citation).toEqual({ documentId: doc.id, title: "policy", filename: "policy.md", mimeType: "text/markdown", passage: 1 });
    expect(results[0]!.snippet.some((s) => s.match && /refund/i.test(s.text))).toBe(true);

    const dubai = (await searchDocuments(owner.ctx, org.id, company.id, { q: "Dubai warehouse" })).results;
    expect(dubai).toHaveLength(1);
    const cited = await getDocument(owner.ctx, org.id, company.id, dubai[0]!.citation.documentId);
    expect(cited.passages[dubai[0]!.citation.passage - 1]!.text).toContain("warehouse in Dubai");

    expect((await searchDocuments(owner.ctx, org.id, company.id, { q: "" })).results).toEqual([]);
    expect((await searchDocuments(owner.ctx, org.id, company.id, { q: "nonexistentword" })).results).toEqual([]);
    expect((await searchDocuments(owner.ctx, org.id, company.id, { q: "the and of" })).results).toEqual([]); // stop words only
    // Query syntax is data, never SQL.
    expect((await searchDocuments(owner.ctx, org.id, company.id, { q: "'); DROP TABLE brain_chunks; --" })).results).toEqual([]);
    expect((await searchDocuments(owner.ctx, org.id, company.id, { q: '"full refund" -warehouse', limit: 1 })).results).toHaveLength(1);
    expect(await db().brainChunk.count()).toBeGreaterThan(0);
  });

  it("rejects unsupported, empty, binary and duplicate content without persisting anything", async () => {
    const { owner, org, company } = await setup();
    await expectCode(ingestDocument(owner.ctx, org.id, company.id, { filename: "deck.pdf", content: "%PDF-1.7" }), "validation_error");
    await expectCode(ingestDocument(owner.ctx, org.id, company.id, { filename: "empty.txt", content: " \n " }), "validation_error");
    await expectCode(ingestDocument(owner.ctx, org.id, company.id, { filename: "fake.txt", content: "\u0000\u0001\u0002ELF" }), "validation_error");
    await ingestDocument(owner.ctx, org.id, company.id, { filename: "a.txt", content: PLAN });
    const dup = (await expectCode(ingestDocument(owner.ctx, org.id, company.id, { filename: "copy.md", content: `${PLAN}\n` }), "conflict")) as { details?: { documentId?: string; reason?: string } };
    expect(dup.details).toMatchObject({ reason: "brain_duplicate", documentId: expect.any(String) });
    const pdf = (await expectCode(ingestDocument(owner.ctx, org.id, company.id, { filename: "x.pdf", content: "x" }), "validation_error")) as { details?: { reason?: string } };
    expect(pdf.details?.reason).toBe("brain_unsupported_type");
    expect(await db().brainDocument.count({ where: { companyId: company.id } })).toBe(1);
  });

  it("deletes a document with its passages", async () => {
    const { owner, org, company } = await setup();
    const doc = await ingestDocument(owner.ctx, org.id, company.id, { content: PLAN });
    await deleteDocument(owner.ctx, org.id, company.id, doc.id);
    expect(await db().brainChunk.count({ where: { documentId: doc.id } })).toBe(0);
    expect((await searchDocuments(owner.ctx, org.id, company.id, { q: "launch" })).results).toEqual([]);
    await expectCode(getDocument(owner.ctx, org.id, company.id, doc.id), "not_found");
    await expectCode(getDocument(owner.ctx, org.id, company.id, "not-a-uuid"), "not_found");
    expect(await db().auditLog.count({ where: { organizationId: org.id, action: "brain.document.deleted" } })).toBe(1);
  });

  it("never reveals another tenant's or company's documents", async () => {
    const a = await setup();
    const b = await setup();
    const doc = await ingestDocument(a.owner.ctx, a.org.id, a.company.id, { filename: "secret.md", content: POLICY });
    for (const call of [
      () => listDocuments(b.owner.ctx, a.org.id, a.company.id),
      () => searchDocuments(b.owner.ctx, a.org.id, a.company.id, { q: "refund" }),
      () => getDocument(b.owner.ctx, a.org.id, a.company.id, doc.id),
      () => getDocument(b.owner.ctx, b.org.id, b.company.id, doc.id), // own company, foreign document id
      () => deleteDocument(b.owner.ctx, b.org.id, b.company.id, doc.id),
      () => ingestDocument(b.owner.ctx, a.org.id, a.company.id, { content: "intrusion" }),
      () => searchDocuments(b.owner.ctx, b.org.id, a.company.id, { q: "refund" }), // own org, foreign company
    ]) await expectCode(call(), "not_found");
    expect((await searchDocuments(b.owner.ctx, b.org.id, b.company.id, { q: "refund" })).results).toEqual([]);
    // A sister company in the same organization has its own brain.
    const sister = await createCompany(a.owner.ctx, a.org.id, { name: "Sister" });
    expect((await searchDocuments(a.owner.ctx, a.org.id, sister.id, { q: "refund" })).results).toEqual([]);
    await expectCode(getDocument(a.owner.ctx, a.org.id, sister.id, doc.id), "not_found");
    // The same content may exist in two companies.
    await ingestDocument(a.owner.ctx, a.org.id, sister.id, { filename: "copy.md", content: POLICY });
  });

  it("viewers and members read and search; only managers add or delete", async () => {
    const { owner, org, company } = await setup();
    const doc = await ingestDocument(owner.ctx, org.id, company.id, { content: PLAN });
    const viewer = await joinAs(owner.ctx, org.id, company.id, "VIEWER");
    const member = await joinAs(owner.ctx, org.id, company.id, "MEMBER");
    const manager = await joinAs(owner.ctx, org.id, company.id, "MANAGER");
    for (const u of [viewer, member]) {
      expect((await searchDocuments(u.ctx, org.id, company.id, { q: "launch" })).results).toHaveLength(1);
      await expectCode(ingestDocument(u.ctx, org.id, company.id, { content: "nope" }), "forbidden");
      await expectCode(deleteDocument(u.ctx, org.id, company.id, doc.id), "forbidden");
    }
    await ingestDocument(manager.ctx, org.id, company.id, { content: "Manager notes on hiring." });
    await deleteDocument(manager.ctx, org.id, company.id, doc.id);
  });

  it("serves ingestion, listing, documents and search over the API", async () => {
    const { owner, org, company } = await setup();
    const { token } = await createSession(db(), owner.user.id, { mfaPending: false, mfaVerifiedAt: new Date() });
    const cookie = `${SESSION_COOKIE}=${token}`;
    const p = params({ orgId: org.id, companyId: company.id });
    const base = `/api/v1/organizations/${org.id}/companies/${company.id}/brain`;

    const created = await ingestRoute(req(`${base}/documents`, { cookie, body: { filename: "policy.md", content: POLICY } }), p);
    expect(created.status).toBe(200);
    const doc = await created.json();
    expect((await ingestRoute(req(`${base}/documents`, { cookie, body: { filename: "x.exe", content: "MZ" } }), p)).status).toBe(400);
    expect((await ingestRoute(req(`${base}/documents`, { cookie, body: { content: "a".repeat(2_100_000) } }), p)).status).toBe(413);
    expect((await ingestRoute(req(`${base}/documents`, { body: { content: PLAN } }), p)).status).toBe(401);

    const list = await (await listRoute(req(`${base}/documents`, { cookie }), p)).json();
    expect(list.data).toEqual([expect.objectContaining({ id: doc.id, passages: 1 })]);
    expect(JSON.stringify(list)).not.toContain("Customers may request"); // listing carries metadata only

    const search = await (await searchRoute(req(`${base}/search?q=refund&limit=5`, { cookie }), p)).json();
    expect(search.results[0].citation).toMatchObject({ documentId: doc.id, title: "policy", passage: 1 });
    expect((await searchRoute(req(`${base}/search?limit=500`, { cookie }), p)).status).toBe(400);

    const one = await documentRoute(req(`${base}/documents/${doc.id}`, { cookie }), params({ orgId: org.id, companyId: company.id, documentId: doc.id }));
    expect((await one.json()).passages[0]).toMatchObject({ number: 1, startOffset: 0 });
  });
});
