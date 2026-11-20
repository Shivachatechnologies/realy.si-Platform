import type { Metadata } from "next";
import Link from "next/link";
import { Bot, CheckCircle2, CircleDollarSign, Coins, LayoutGrid, List, Loader2, Rocket, XCircle } from "lucide-react";
import { AutoRefresh } from "@/components/agents/auto-refresh";
import { TaskStatusBadge } from "@/components/agents/status-badge";
import { HelpMeButton } from "@/components/guide-kit/help-me";
import { PageIntro } from "@/components/guide-kit/page-intro";
import { SmartEmpty } from "@/components/guide-kit/smart-empty";
import { introLabels, latestSubjectTask } from "@/components/guide-kit/server";
import { JobComposer } from "@/components/mission/job-composer";
import { TaskLanes, type LaneTask } from "@/components/mission/task-lanes";
import { LiveDot } from "@/components/motion/live-dot";
import { AiAvatar } from "@/components/workforce/avatar";
import { Pager, qs } from "@/components/workforce/states";
import { WorkforceTabs } from "@/components/workforce/workforce-tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { PageHeader } from "@/components/ui/page-header";
import { StatGrid, StatTile } from "@/components/ui/stat-tile";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { getLocale, getT } from "@/i18n/server";
import { formatDateTime, formatNumber } from "@/i18n/format";
import { cn } from "@/lib/utils";
import { db } from "@/server/core/db";
import { getDraft } from "@/server/modules/cockpit/drafts";
import { AGENT_PROFILES } from "@/server/modules/agents/profiles";
import { aiConfigured } from "@/server/modules/agents/runtime";
import { aiUsageToday, listTasks, taskFilters } from "@/server/modules/agents/service";
import { AGENT_TASK_STATUSES } from "@/server/modules/agents/statuses";
import { listObjectives } from "@/server/modules/objectives/service";
import { can } from "@/server/modules/rbac/service";
import { companyChain } from "@/server/modules/rbac/scope";
import { costMicros, microsToCents } from "@/server/modules/workforce/pricing";
import { listEmployees } from "@/server/modules/workforce/service";
import { requireOrgContext } from "@/server/workspace";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("modules.tasks.title") };
}

const PAGE = 50;
const DAY = 86_400_000;

export default async function TasksPage({ searchParams }: PageProps<"/[locale]/tasks">) {
  const locale = await getLocale();
  const t = await getT(locale);
  const { viewer, org, company } = await requireOrgContext(locale);
  const sp = Object.fromEntries(Object.entries(await searchParams).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v])) as Record<string, string | undefined>;

  const header = (
    <PageHeader icon={<Bot />} eyebrow={t("missionControl.eyebrow")} title={t("modules.tasks.title")} description={t("agentTasks.subtitle", { company: company?.name ?? "—" })}>
      <WorkforceTabs locale={locale} active="tasks" labels={{ employees: t("workforce.tabs.employees"), hire: t("workforce.tabs.hire"), usage: t("workforce.tabs.usage"), plans: t("workforce.tabs.plans"), tasks: t("workforce.tabs.tasks") }} />
    </PageHeader>
  );
  if (!company) {
    return (
      <div className="mx-auto grid max-w-[1400px] gap-4">
        {header}
        <Card>
          <p className="p-4 text-muted-foreground">{t("company.empty")}</p>
        </Card>
      </div>
    );
  }

  const chain = await companyChain(db(), org.id, company.id);
  const [canRead, canRun] = await Promise.all([can(viewer.ctx, "agents.read", chain), can(viewer.ctx, "agents.run", chain)]);
  if (!canRead) {
    return (
      <div className="mx-auto grid max-w-[1400px] gap-4">
        {header}
        <Notice tone="warning">{t("errors.forbidden")}</Notice>
      </div>
    );
  }
  const view = sp.view === "list" ? "list" : "lanes";
  const filters = taskFilters.parse({ ...sp, aiEmployeeId: sp.employee });
  const where = { organizationId: org.id, companyId: company.id };
  const nowMs = new Date().getTime();
  const today = new Date(nowMs - (nowMs % DAY));
  const [page, usage, objectives, employees, byStatus, doneToday, failedToday, week, draft, helpTask] = await Promise.all([
    listTasks(viewer.ctx, org.id, company.id, { ...filters, limit: PAGE, cursor: sp.cursor }),
    aiUsageToday(org.id, company.id),
    can(viewer.ctx, "objectives.read", chain).then((ok) => (ok ? listObjectives(viewer.ctx, org.id, company.id) : [])),
    listEmployees(viewer.ctx, org.id, company.id),
    db().agentTask.groupBy({ by: ["status"], where, _count: true }),
    db().agentTask.count({ where: { ...where, status: "COMPLETED", completedAt: { gte: today } } }),
    db().agentTask.count({ where: { ...where, status: "FAILED", completedAt: { gte: today } } }),
    db().agentTask.groupBy({ by: ["model"], where: { ...where, startedAt: { gte: new Date(nowMs - 7 * DAY) } }, _sum: { inputTokens: true, outputTokens: true } }),
    canRun ? getDraft(viewer.ctx, org.id, company.id, "tasks.composer").catch(() => null) : null,
    canRun ? latestSubjectTask(viewer.ctx, org.id, company.id, "ai_tasks", company.id) : null,
  ]);
  const tasks = page.data;
  const configured = aiConfigured();
  const statusCount = (s: string) => byStatus.find((r) => r.status === s)?._count ?? 0;
  const totalTasks = byStatus.reduce((a, r) => a + r._count, 0);
  const weekCostCents = week.reduce((a, r) => a + microsToCents(costMicros(r.model, r._sum.inputTokens ?? 0, r._sum.outputTokens ?? 0)), 0n);
  const employeeById = new Map(employees.map((e) => [e.id, e]));
  const milestoneLabel = new Map(objectives.flatMap((o) => o.milestones.map((m) => [m.id, `${o.title} — ${m.title}`] as const)));
  const openMilestones = objectives
    .filter((o) => o.status === "ACTIVE")
    .flatMap((o) => o.milestones.filter((m) => !m.completedAt).map((m) => ({ id: m.id, label: `${o.title} — ${m.title}` })));
  const subjectTypes = (await db().agentTask.groupBy({ by: ["subjectType"], where: { ...where, subjectType: { not: null } }, orderBy: { subjectType: "asc" }, take: 50 })).map((r) => r.subjectType!).sort();
  const filterParams = { employee: filters.aiEmployeeId, status: filters.status, profile: filters.profile, subjectType: filters.subjectType, q: filters.q };
  const filtered = Object.values(filterParams).some(Boolean);
  const label = (key: string, fallback: string) => (t(key) === key ? fallback : t(key));
  const subjectLabel = (s: string | null) => (s ? label(`agentTasks.subjects.${s}`, s.replace(/_/g, " ")) : null);
  const apiBase = `/api/v1/organizations/${org.id}/companies/${company.id}`;
  const path = `/${locale}/tasks`;
  const viewParam = view === "list" ? "list" : undefined;
  const activeEmployees = employees.filter((e) => e.status === "ACTIVE");
  const initialWho =
    sp.employee && activeEmployees.some((e) => e.id === sp.employee) ? `emp:${sp.employee}` : sp.profile && AGENT_PROFILES.some((p) => p.key === sp.profile) ? `role:${sp.profile}` : undefined;
  const canCompose = canRun && configured && !usage.exhausted;
  const running = statusCount("RUNNING") + statusCount("QUEUED");

  const lanes: LaneTask[] = tasks.map((x) => {
    const emp = x.aiEmployeeId ? employeeById.get(x.aiEmployeeId) : undefined;
    return {
      id: x.id,
      title: x.title,
      status: x.status,
      role: t(`profiles.${x.profile}.name`),
      employee: emp ? { id: emp.id, name: emp.name, initials: emp.initials, paused: emp.status === "PAUSED" } : null,
      createdAt: x.createdAt.toISOString(),
      delegated: !!x.parentTaskId,
      subject: subjectLabel(x.subjectType),
      tokens: (x.inputTokens ?? 0) + (x.outputTokens ?? 0),
    };
  });

  const chip = (text: string, params: Record<string, string | undefined>, active: boolean) => (
    <Link
      key={text}
      href={`${path}${qs({ ...filterParams, view: viewParam, ...params })}`}
      aria-current={active ? "true" : undefined}
      className={cn("rounded-full border px-3 py-1 text-xs", active ? "border-primary bg-accent font-medium" : "hover:bg-muted")}
    >
      {text}
    </Link>
  );
  const viewLink = (v: "lanes" | "list", icon: React.ReactNode) => (
    <Link
      href={`${path}${qs({ ...filterParams, view: v === "list" ? "list" : undefined })}`}
      aria-current={view === v ? "true" : undefined}
      className={cn("inline-flex items-center gap-1 rounded px-2 py-1 text-xs", view === v ? "bg-accent font-medium" : "text-muted-foreground hover:text-foreground")}
    >
      {icon} {t(`missionControl.view.${v}`)}
    </Link>
  );

  return (
    <div className="mx-auto grid max-w-[1400px] gap-4">
      {header}
      <AutoRefresh active={tasks.some((x) => x.status === "QUEUED" || x.status === "RUNNING")} />
      <PageIntro
        labels={introLabels(t)}
        what={t("missionControl.intro.what")}
        why={t("missionControl.intro.why")}
        can={t("missionControl.intro.can")}
        next={canCompose ? { label: t("missionControl.intro.next"), href: "#composer" } : { label: t("missionControl.intro.nextHire"), href: `/${locale}/workforce/hire` }}
      />
      {!configured ? <Notice tone="warning">{t("agentTasks.notConfigured")}</Notice> : null}
      {usage.exhausted ? <Notice tone="warning">{t("agentTasks.budgetExhausted")}</Notice> : null}

      <StatGrid>
        <StatTile index={0} label={t("missionControl.stats.working")} value={running} icon={<Loader2 />} live={running > 0} hint={t("missionControl.stats.workingHint", { queued: formatNumber(statusCount("QUEUED"), locale) })} href={`${path}${qs({ status: "RUNNING" })}`} />
        <StatTile index={1} label={t("missionControl.stats.doneToday")} value={doneToday} icon={<CheckCircle2 />} hint={t("missionControl.stats.total", { count: totalTasks })} />
        <StatTile index={2} label={t("missionControl.stats.failedToday")} value={failedToday} icon={<XCircle />} hint={t("missionControl.stats.failedHint")} href={`${path}${qs({ status: "FAILED" })}`} />
        <StatTile
          index={3}
          label={t("missionControl.stats.tokensToday")}
          value={usage.used}
          format="compact"
          icon={<Coins />}
          hint={usage.limit ? t("agentTasks.usageToday", { used: formatNumber(usage.used, locale), limit: formatNumber(usage.limit, locale) }) : t("agentTasks.usageTodayUnlimited", { used: formatNumber(usage.used, locale) })}
        />
      </StatGrid>
      <p className="-mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
        <CircleDollarSign className="size-3.5" aria-hidden />
        {t("missionControl.stats.weekCost", { cost: new Intl.NumberFormat(locale, { style: "currency", currency: "USD" }).format(Number(weekCostCents) / 100) })}
      </p>

      {canCompose ? (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <Card variant="highlight" id="composer" className="scroll-mt-20">
            <CardHeader icon={<Rocket />} title={t("missionControl.composer.title")} description={t("missionControl.composer.subtitle")} />
            <CardBody>
              <JobComposer
                base={apiBase}
                locale={locale}
                employees={activeEmployees.map((e) => ({ id: e.id, name: e.name, initials: e.initials, department: e.department, profileKey: e.profileKey, jobTitle: e.jobTitle }))}
                roles={AGENT_PROFILES.map((p) => ({ key: p.key, department: p.department ?? "general" }))}
                milestones={openMilestones}
                initialWho={initialWho}
                draft={draft ? { step: draft.step, data: draft.data } : null}
              />
            </CardBody>
          </Card>
          <Card variant="glass">
            <CardHeader title={t("missionControl.help.title")} description={t("missionControl.help.hint")} />
            <CardBody>
              <HelpMeButton
                base={apiBase}
                aiReady={configured && canRun}
                profile="ai_ceo"
                subject={{ type: "ai_tasks", id: company.id }}
                title="Suggest jobs for my AI team"
                instructions={`The person is on the AI Tasks page (mission control) and is new to working with AI employees. Their hired AI employees: ${activeEmployees.map((e) => `${e.name} (${e.profileKey}, ${e.department})`).join("; ") || "none yet"}. Recent tasks: ${tasks.slice(0, 10).map((x) => `"${x.title}" [${x.status}]`).join("; ") || "none yet"}. Read the company's objectives and KPIs, then suggest the 3 most valuable jobs to give these AI employees this week. For each: who should do it, a one-line title and a short brief they can paste into "Give an AI employee a job". Plain words, no jargon.`}
                initial={helpTask}
              />
            </CardBody>
          </Card>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {chip(t("common.all"), { status: undefined }, !filters.status)}
        {AGENT_TASK_STATUSES.map((s) => chip(t(`agentTasks.status.${s}`), { status: s }, filters.status === s))}
        <span className="ms-auto inline-flex rounded-md border p-0.5" role="group" aria-label={t("missionControl.view.label")}>
          {viewLink("lanes", <LayoutGrid className="size-3.5" aria-hidden />)}
          {viewLink("list", <List className="size-3.5" aria-hidden />)}
        </span>
      </div>

      <details className="rounded-lg border bg-surface px-3 py-2" open={!!(filters.q || filters.aiEmployeeId || filters.profile || filters.subjectType)}>
        <summary className="cursor-pointer text-sm font-medium">{t("missionControl.moreFilters")}</summary>
        <form method="get" className="mt-2 flex flex-wrap items-end gap-2">
          {viewParam ? <input type="hidden" name="view" value={viewParam} /> : null}
          {filters.status ? <input type="hidden" name="status" value={filters.status} /> : null}
          <label className="grid gap-1 text-xs text-muted-foreground">
            {t("agentTasks.filters.search")}
            <Input name="q" defaultValue={filters.q ?? ""} className="h-8 w-48" />
          </label>
          <label className="grid gap-1 text-xs text-muted-foreground">
            {t("agentTasks.columns.employee")}
            <Select name="employee" defaultValue={filters.aiEmployeeId ?? ""} className="h-8 w-44">
              <option value="">{t("common.all")}</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </Select>
          </label>
          <label className="grid gap-1 text-xs text-muted-foreground">
            {t("agentTasks.profile")}
            <Select name="profile" defaultValue={filters.profile ?? ""} className="h-8 w-44">
              <option value="">{t("common.all")}</option>
              {AGENT_PROFILES.map((p) => (
                <option key={p.key} value={p.key}>
                  {t(`profiles.${p.key}.name`)}
                </option>
              ))}
            </Select>
          </label>
          {subjectTypes.length ? (
            <label className="grid gap-1 text-xs text-muted-foreground">
              {t("agentTasks.filters.subject")}
              <Select name="subjectType" defaultValue={filters.subjectType ?? ""} className="h-8 w-40">
                <option value="">{t("common.all")}</option>
                {subjectTypes.map((s) => (
                  <option key={s} value={s}>
                    {subjectLabel(s)}
                  </option>
                ))}
              </Select>
            </label>
          ) : null}
          <Button type="submit" size="sm" variant="secondary">
            {t("workforce.filters.apply")}
          </Button>
          {filtered ? (
            <Link href={`${path}${qs({ view: viewParam })}`} className="text-sm text-muted-foreground hover:underline">
              {t("workforce.filters.clear")}
            </Link>
          ) : null}
        </form>
      </details>

      {tasks.length === 0 ? (
        <Card>
          {filtered ? (
            <CardBody className="text-sm text-muted-foreground">{t("common.noResults")}</CardBody>
          ) : (
            <SmartEmpty
              icon={<Bot />}
              title={t("missionControl.empty.title")}
              body={t("missionControl.empty.body")}
              primary={
                canCompose ? (
                  <Button asChild size="sm">
                    <a href="#composer">{t("missionControl.intro.next")}</a>
                  </Button>
                ) : (
                  <Button asChild size="sm">
                    <Link href={`/${locale}/workforce/hire`}>{t("workforce.hire.title")}</Link>
                  </Button>
                )
              }
              ai={
                <Button asChild size="sm" variant="secondary">
                  <Link href={`/${locale}/plans`}>{t("missionControl.empty.schedule")}</Link>
                </Button>
              }
            />
          )}
        </Card>
      ) : view === "lanes" ? (
        <div className="grid gap-2">
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            {running ? <LiveDot tone="info" /> : null}
            {t("missionControl.lanes.caption", { count: tasks.length })}
          </p>
          <TaskLanes tasks={lanes} base={apiBase} canRun={canRun} aiReady={configured} moreHrefs={Object.fromEntries(AGENT_TASK_STATUSES.map((s) => [s, `${path}${qs({ ...filterParams, status: s, view: "list" })}`]))} />
          {page.nextCursor ? (
            <Link href={`${path}${qs({ ...filterParams, view: "list", cursor: page.nextCursor })}`} className="justify-self-start text-xs text-primary hover:underline">
              {t("missionControl.lanes.older")}
            </Link>
          ) : null}
        </div>
      ) : (
        <Card>
          <CardHeader title={t("agentTasks.list")} description={t("agentTasks.count", { count: tasks.length })} />
          <Table>
            <THead>
              <Tr>
                <Th>{t("agentTasks.columns.title")}</Th>
                <Th>{t("agentTasks.columns.employee")}</Th>
                <Th>{t("agentTasks.columns.status")}</Th>
                <Th>{t("missionControl.columns.tokens")}</Th>
                <Th>{t("agentTasks.columns.created")}</Th>
              </Tr>
            </THead>
            <TBody>
              {tasks.map((x) => {
                const emp = x.aiEmployeeId ? employeeById.get(x.aiEmployeeId) : undefined;
                return (
                  <Tr key={x.id}>
                    <Td className="font-medium">
                      <Link className="hover:underline" href={`/${locale}/tasks/${x.id}`}>
                        {x.title}
                      </Link>
                      <div className="flex flex-wrap gap-1 text-xs font-normal text-muted-foreground">
                        {x.milestoneId && milestoneLabel.has(x.milestoneId) ? <span>{milestoneLabel.get(x.milestoneId)}</span> : null}
                        {x.parentTaskId ? <Badge>{t("workforce.queue.delegated")}</Badge> : null}
                        {x.subjectType ? <Badge>{subjectLabel(x.subjectType)}</Badge> : null}
                      </div>
                    </Td>
                    <Td>
                      {emp ? (
                        <Link href={`/${locale}/workforce/${emp.id}`} className="flex items-center gap-2 hover:underline">
                          <AiAvatar id={emp.id} initials={emp.initials} size="sm" paused={emp.status === "PAUSED"} />
                          <span className="grid">
                            <span>{emp.name}</span>
                            <span className="text-xs text-muted-foreground">{t(`profiles.${x.profile}.name`)}</span>
                          </span>
                        </Link>
                      ) : (
                        t(`profiles.${x.profile}.name`)
                      )}
                    </Td>
                    <Td>
                      <TaskStatusBadge status={x.status} label={t(`agentTasks.status.${x.status}`)} />
                    </Td>
                    <Td className="tabular-nums text-muted-foreground">{x.inputTokens || x.outputTokens ? formatNumber((x.inputTokens ?? 0) + (x.outputTokens ?? 0), locale) : "—"}</Td>
                    <Td className="whitespace-nowrap text-muted-foreground">{formatDateTime(x.createdAt, locale, viewer.user.timezone)}</Td>
                  </Tr>
                );
              })}
            </TBody>
          </Table>
          <Pager
            prevHref={sp.cursor ? `${path}${qs({ ...filterParams, view: "list" })}` : null}
            nextHref={page.nextCursor ? `${path}${qs({ ...filterParams, view: "list", cursor: page.nextCursor })}` : null}
            labels={{ previous: t("agentTasks.firstPage"), next: t("common.next") }}
          />
        </Card>
      )}
    </div>
  );
}
