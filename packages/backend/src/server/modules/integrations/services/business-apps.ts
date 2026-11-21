import "server-only";
import { providerFetch } from "../client";
import { activeAccount } from "../connections";
import { recordUsage } from "../usage";
import { ensureOk, errorText, withFallback, type ServiceResult } from "./common";

/**
 * Business-app adapters: Pipedrive (persons, deals, activities), Notion (search, create page) and ClickUp (lists,
 * create task). Data changes at the provider are external writes: callers gate them (SUPERVISED tools / user action).
 */

// ───────────── Pipedrive ─────────────

const PIPEDRIVE = "https://api.pipedrive.com/v1";

export interface PipedriveDealInput {
  title: string;
  /** Value in major units of `currency` (Pipedrive stores decimals). */
  value?: number;
  currency?: string;
  personId?: number;
  orgId?: number;
}

export async function createPipedriveDeal(organizationId: string, companyId: string, input: PipedriveDealInput): Promise<ServiceResult<{ id: number; url: string | null }>> {
  const title = input.title.trim();
  if (!title || title.length > 255) return { ok: false, code: "invalid_input", error: "Deal title is required (max 255)", providerId: null, attempts: [] };
  return withFallback(organizationId, companyId, ["pipedrive"], async (conn) => {
    const res = await providerFetch<{ data?: { id?: number } }>(conn, `${PIPEDRIVE}/deals`, {
      json: { title, ...(input.value !== undefined ? { value: input.value } : {}), ...(input.currency && /^[A-Z]{3}$/.test(input.currency) ? { currency: input.currency } : {}), ...(input.personId ? { person_id: input.personId } : {}), ...(input.orgId ? { org_id: input.orgId } : {}) },
      retries: 1,
    });
    ensureOk(res, "Pipedrive deal");
    const id = res.data?.data?.id;
    if (!id) throw new Error("Pipedrive returned no deal id");
    await recordUsage({ organizationId, companyId, connectionId: conn.id, provider: "pipedrive", operation: "crm.deal_create", status: "SUCCEEDED", meta: { dealId: id } });
    const domain = typeof conn.config.companyDomain === "string" ? conn.config.companyDomain : null;
    return { id, url: domain && /^[a-z0-9-]{1,63}$/.test(domain) ? `https://${domain}.pipedrive.com/deal/${id}` : null };
  });
}

export async function listPipedriveDeals(organizationId: string, companyId: string, opts: { status?: "open" | "won" | "lost" | "all_not_deleted" } = {}): Promise<ServiceResult<{ id: number; title: string; value: number | null; currency: string | null; status: string | null; stageId: number | null }[]>> {
  return withFallback(organizationId, companyId, ["pipedrive"], async (conn) => {
    const res = await providerFetch<{ data?: { id: number; title?: string; value?: number; currency?: string; status?: string; stage_id?: number }[] | null }>(conn, `${PIPEDRIVE}/deals?limit=100&status=${opts.status ?? "open"}`, { retries: 2 });
    ensureOk(res, "Pipedrive deals");
    return (res.data?.data ?? []).map((d) => ({ id: d.id, title: d.title ?? "", value: d.value ?? null, currency: d.currency ?? null, status: d.status ?? null, stageId: d.stage_id ?? null }));
  });
}

// ───────────── Notion ─────────────

const NOTION = "https://api.notion.com/v1";

export interface NotionItem {
  id: string;
  object: "page" | "database";
  title: string;
  url: string | null;
  lastEditedAt: string | null;
}

const notionTitle = (o: Record<string, unknown>): string => {
  const plain = (arr: unknown) => (Array.isArray(arr) ? arr.map((t) => String((t as { plain_text?: string }).plain_text ?? "")).join("") : "");
  if (Array.isArray(o.title)) return plain(o.title);
  const props = (o.properties ?? {}) as Record<string, { type?: string; title?: unknown }>;
  const t = Object.values(props).find((p) => p.type === "title");
  return t ? plain(t.title) : "";
};

/** Pages and databases shared with the integration (Notion only returns what the user shared with it). */
export async function searchNotion(organizationId: string, companyId: string, query: string): Promise<ServiceResult<NotionItem[]>> {
  return withFallback(organizationId, companyId, ["notion"], async (conn) => {
    const res = await providerFetch<{ results?: Record<string, unknown>[] }>(conn, `${NOTION}/search`, { json: { query: query.slice(0, 200), page_size: 25 }, retries: 2 });
    ensureOk(res, "Notion search");
    return (res.data?.results ?? []).map((r) => ({ id: String(r.id), object: r.object === "database" ? ("database" as const) : ("page" as const), title: notionTitle(r) || "Untitled", url: typeof r.url === "string" ? r.url : null, lastEditedAt: typeof r.last_edited_time === "string" ? r.last_edited_time : null }));
  });
}

/** Create a page under a parent page (or as a row of a database, using its title property) with plain paragraphs. */
export async function createNotionPage(
  organizationId: string,
  companyId: string,
  input: { parentId: string; parentType: "page" | "database"; title: string; paragraphs?: string[]; titleProperty?: string },
): Promise<ServiceResult<{ id: string; url: string | null }>> {
  if (!/^[a-f0-9-]{32,36}$/.test(input.parentId)) return { ok: false, code: "invalid_input", error: "Invalid Notion parent id", providerId: null, attempts: [] };
  const title = input.title.trim().slice(0, 200);
  if (!title) return { ok: false, code: "invalid_input", error: "Title is required", providerId: null, attempts: [] };
  return withFallback(organizationId, companyId, ["notion"], async (conn) => {
    const rich = (text: string) => [{ type: "text", text: { content: text.slice(0, 2000) } }];
    const res = await providerFetch<{ id?: string; url?: string }>(conn, `${NOTION}/pages`, {
      json: {
        parent: input.parentType === "database" ? { database_id: input.parentId } : { page_id: input.parentId },
        properties: input.parentType === "database" ? { [input.titleProperty ?? "Name"]: { title: rich(title) } } : { title: { title: rich(title) } },
        children: (input.paragraphs ?? []).slice(0, 90).map((p) => ({ object: "block", type: "paragraph", paragraph: { rich_text: rich(p) } })),
      },
      retries: 1,
    });
    ensureOk(res, "Notion page");
    if (!res.data?.id) throw new Error("Notion returned no page id");
    await recordUsage({ organizationId, companyId, connectionId: conn.id, provider: "notion", operation: "docs.page_create", status: "SUCCEEDED", meta: { pageId: res.data.id } });
    return { id: res.data.id, url: res.data.url ?? null };
  });
}

// ───────────── ClickUp ─────────────

const CLICKUP = "https://api.clickup.com/api/v2";

/** Lists of the active workspace (spaces → folderless lists and folder lists), for choosing where tasks go. */
export async function listClickUpLists(organizationId: string, companyId: string): Promise<ServiceResult<{ id: string; name: string; space: string }[]>> {
  return withFallback(organizationId, companyId, ["clickup"], async (conn) => {
    const team = activeAccount(conn);
    if (!team) throw new Error("No ClickUp workspace selected; run a connection test");
    const spaces = await providerFetch<{ spaces?: { id: string; name: string }[] }>(conn, `${CLICKUP}/team/${encodeURIComponent(team.id)}/space?archived=false`, { retries: 2 });
    ensureOk(spaces, "ClickUp spaces");
    const out: { id: string; name: string; space: string }[] = [];
    for (const sp of (spaces.data?.spaces ?? []).slice(0, 10)) {
      const [lists, folders] = await Promise.all([
        providerFetch<{ lists?: { id: string; name: string }[] }>(conn, `${CLICKUP}/space/${encodeURIComponent(sp.id)}/list?archived=false`, { retries: 1 }),
        providerFetch<{ folders?: { name: string; lists?: { id: string; name: string }[] }[] }>(conn, `${CLICKUP}/space/${encodeURIComponent(sp.id)}/folder?archived=false`, { retries: 1 }),
      ]);
      for (const l of lists.ok ? (lists.data?.lists ?? []) : []) out.push({ id: l.id, name: l.name, space: sp.name });
      for (const f of folders.ok ? (folders.data?.folders ?? []) : []) for (const l of f.lists ?? []) out.push({ id: l.id, name: `${f.name} / ${l.name}`, space: sp.name });
    }
    return out.slice(0, 200);
  });
}

export async function createClickUpTask(
  organizationId: string,
  companyId: string,
  input: { listId: string; name: string; description?: string; dueAt?: Date; priority?: 1 | 2 | 3 | 4 },
): Promise<ServiceResult<{ id: string; url: string | null }>> {
  if (!/^\d{1,20}$/.test(input.listId)) return { ok: false, code: "invalid_input", error: "Invalid ClickUp list id", providerId: null, attempts: [] };
  const name = input.name.trim().slice(0, 500);
  if (!name) return { ok: false, code: "invalid_input", error: "Task name is required", providerId: null, attempts: [] };
  return withFallback(organizationId, companyId, ["clickup"], async (conn) => {
    try {
      const res = await providerFetch<{ id?: string; url?: string }>(conn, `${CLICKUP}/list/${input.listId}/task`, {
        json: { name, ...(input.description ? { description: input.description.slice(0, 10_000) } : {}), ...(input.dueAt ? { due_date: input.dueAt.getTime() } : {}), ...(input.priority ? { priority: input.priority } : {}) },
        retries: 1,
      });
      ensureOk(res, "ClickUp task");
      if (!res.data?.id) throw new Error("ClickUp returned no task id");
      await recordUsage({ organizationId, companyId, connectionId: conn.id, provider: "clickup", operation: "tasks.create", status: "SUCCEEDED", meta: { taskId: res.data.id } });
      return { id: res.data.id, url: res.data.url ?? null };
    } catch (err) {
      await recordUsage({ organizationId, companyId, connectionId: conn.id, provider: "clickup", operation: "tasks.create", units: 0, status: "FAILED", error: errorText(err) });
      throw err;
    }
  });
}
