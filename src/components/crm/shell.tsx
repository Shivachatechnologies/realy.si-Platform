import { cache, type ReactNode } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { getLocale, getT } from "@/i18n/server";
import { formatDateTime } from "@/i18n/format";
import { db } from "@/server/core/db";
import { aiConfigured } from "@/server/modules/agents/runtime";
import { listSubjectTasks } from "@/server/modules/agents/service";
import { can } from "@/server/modules/rbac/service";
import { companyChain } from "@/server/modules/rbac/scope";
import { requireOrgContext } from "@/server/workspace";
import { CrmTabs, SalesTabs, type CrmTab, type SalesTab } from "./crm-tabs";

/** Server helpers shared by the CRM & Sales pages: context + permission gate, page frame, pager, AI task list. */

export const crmContext = cache(async () => {
  const locale = await getLocale();
  const t = await getT(locale);
  const { viewer, org, company } = await requireOrgContext(locale);
  if (!company) return { locale, t, viewer, org, company: null } as const;
  const chain = await companyChain(db(), org.id, company.id);
  const [canRead, canManage, canRunAgents, canReadAgents] = await Promise.all([
    can(viewer.ctx, "sales.read", chain),
    can(viewer.ctx, "sales.manage", chain),
    can(viewer.ctx, "agents.run", chain),
    can(viewer.ctx, "agents.read", chain),
  ]);
  return {
    locale,
    t,
    viewer,
    org,
    company,
    canRead,
    canManage,
    canRunAgents,
    canReadAgents,
    base: `/api/v1/organizations/${org.id}/companies/${company.id}`,
    tz: company.timezone ?? "UTC",
    currency: company.baseCurrency,
  } as const;
});

export function PageFrame({ title, subtitle, actions, tabs, children, wide = true }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; tabs?: ReactNode; children: ReactNode; wide?: boolean }) {
  return (
    <div className={`mx-auto grid ${wide ? "max-w-[1400px]" : "max-w-[1100px]"} gap-4`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid min-w-0 gap-1">
          <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
          {subtitle ? <p className="text-muted-foreground">{subtitle}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {tabs}
      {children}
    </div>
  );
}

/** Frame for CRM pages: handles "no company" and "forbidden"; renders children only when allowed. */
export async function CrmFrame({ active, title, subtitle, actions, children, area = "crm" }: { active: CrmTab | SalesTab; title?: string; subtitle?: string; actions?: ReactNode; children: ReactNode; area?: "crm" | "sales" }) {
  const c = await crmContext();
  const t = c.t;
  const tabs = area === "crm" ? <CrmTabs locale={c.locale} active={active as CrmTab} /> : <SalesTabs locale={c.locale} active={active as SalesTab} />;
  const heading = title ?? t(area === "crm" ? "modules.crm.title" : "modules.sales.title");
  if (!c.company) {
    return (
      <PageFrame title={heading} subtitle={subtitle}>
        <Card>
          <p className="p-4 text-muted-foreground">{t("company.empty")}</p>
        </Card>
      </PageFrame>
    );
  }
  if (!c.canRead) {
    return (
      <PageFrame title={heading} subtitle={subtitle} tabs={tabs}>
        <Notice tone="warning">{t("errors.forbidden")}</Notice>
      </PageFrame>
    );
  }
  return (
    <PageFrame title={heading} subtitle={subtitle} actions={actions} tabs={tabs}>
      {children}
    </PageFrame>
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <Card className="p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-xl font-semibold tabular-nums">{value}</p>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </Card>
  );
}

export function Facts({ items, cols = 3 }: { items: [string, ReactNode][]; cols?: 2 | 3 | 4 }) {
  const grid = cols === 2 ? "sm:grid-cols-2" : cols === 4 ? "sm:grid-cols-4" : "sm:grid-cols-3";
  return (
    <dl className={`grid gap-3 text-sm ${grid}`}>
      {items.map(([k, v]) => (
        <div key={k} className="grid min-w-0 gap-0.5">
          <dt className="text-xs text-muted-foreground">{k}</dt>
          <dd className="break-words">{v ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Previous/next links preserving the current query. */
export async function Pager({ path, query, page, pageSize, total }: { path: string; query: Record<string, string | string[] | undefined>; page: number; pageSize: number; total: number }) {
  const t = await getT();
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  const href = (p: number) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) if (typeof v === "string" && v && k !== "page") q.set(k, v);
    q.set("page", String(p));
    return `${path}?${q}`;
  };
  return (
    <nav className="flex items-center justify-between gap-2 border-t p-3 text-sm" aria-label={t("crm.pagination")}>
      {page > 1 ? (
        <Link href={href(page - 1)} className="hover:underline">
          ← {t("common.previous")}
        </Link>
      ) : (
        <span />
      )}
      <span className="text-xs text-muted-foreground">{t("crm.pageOf", { page, pages })}</span>
      {page < pages ? (
        <Link href={href(page + 1)} className="hover:underline">
          {t("common.next")} →
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}

export const DEAL_STATUS_TONE = { OPEN: "neutral", WON: "success", LOST: "danger" } as const;

const TASK_TONE = { QUEUED: "neutral", RUNNING: "accent", COMPLETED: "success", FAILED: "danger", CANCELLED: "neutral" } as const;

/** AI tasks attached to a record, with status and the start of the deliverable. */
export async function SubjectTasks({ subjectType, subjectId, actions }: { subjectType: string; subjectId: string; actions?: ReactNode }) {
  const c = await crmContext();
  if (!c.company || !(c.canReadAgents || c.canRunAgents)) return null;
  const t = c.t;
  const tasks = c.canReadAgents ? await listSubjectTasks(c.viewer.ctx, c.org.id, c.company.id, subjectType, subjectId, 5) : [];
  return (
    <Card>
      <CardHeader title={t("crm.ai.title")} description={t("crm.ai.description")} />
      <CardBody className="grid gap-3">
        {c.canRunAgents ? aiConfigured() ? actions : <Notice tone="warning">{t("agentTasks.notConfigured")}</Notice> : null}
        {tasks.length ? (
          <ul className="grid gap-3 text-sm">
            {tasks.map((task) => (
              <li key={task.id} className="grid gap-1">
                <span className="flex flex-wrap items-center gap-2">
                  <Badge tone={TASK_TONE[task.status]}>{t(`agentTasks.status.${task.status}`)}</Badge>
                  <Link href={`/${c.locale}/tasks/${task.id}`} className="font-medium hover:underline">
                    {task.title}
                  </Link>
                  <span className="text-xs text-muted-foreground">{formatDateTime(task.createdAt, c.locale, c.tz)}</span>
                </span>
                {task.output ? <p className="line-clamp-4 whitespace-pre-wrap text-xs text-muted-foreground">{task.output.slice(0, 800)}</p> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">{t("crm.ai.none")}</p>
        )}
      </CardBody>
    </Card>
  );
}

export function TagList({ tags }: { tags: string[] }) {
  if (!tags.length) return null;
  return (
    <span className="flex flex-wrap gap-1">
      {tags.map((t) => (
        <Badge key={t}>#{t}</Badge>
      ))}
    </span>
  );
}
