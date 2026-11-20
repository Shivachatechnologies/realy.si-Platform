import type { Metadata } from "next";
import Link from "next/link";
import { AlarmClock, CheckCircle2, Inbox, ShieldAlert, ShieldCheck } from "lucide-react";
import { WorkflowApprovalsPanel } from "@/components/automation/approvals-panel";
import { BulkApprove } from "@/components/decisions/decision-actions";
import { DecisionCard } from "@/components/decisions/decision-card";
import { loadDecisionPreviews } from "@/components/decisions/load";
import { HelpMeButton } from "@/components/guide-kit/help-me";
import { PageIntro } from "@/components/guide-kit/page-intro";
import { SmartEmpty } from "@/components/guide-kit/smart-empty";
import { introLabels, latestSubjectTask } from "@/components/guide-kit/server";
import { Term } from "@/components/guide-kit/term";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { PageHeader } from "@/components/ui/page-header";
import { StatGrid, StatTile } from "@/components/ui/stat-tile";
import { getLocale, getT } from "@/i18n/server";
import { cn } from "@/lib/utils";
import { db } from "@/server/core/db";
import { aiConfigured } from "@/server/modules/agents/runtime";
import { listApprovals } from "@/server/modules/approvals/service";
import { can } from "@/server/modules/rbac/service";
import { companyChain } from "@/server/modules/rbac/scope";
import { requireOrgContext } from "@/server/workspace";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("modules.approvals.title") };
}

const OUTCOMES = ["EXECUTED", "REJECTED", "FAILED", "EXPIRED"] as const;
const HISTORY_PAGE = 20;

export default async function ApprovalsPage({ searchParams }: PageProps<"/[locale]/approvals">) {
  const locale = await getLocale();
  const t = await getT(locale);
  const { viewer, org, company } = await requireOrgContext(locale);
  const sp = await searchParams;
  const header = <PageHeader icon={<ShieldCheck />} eyebrow={t("decisionInbox.eyebrow")} title={t("modules.approvals.title")} description={t("decisionInbox.subtitle")} />;
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
  // Workflow approval gates addressed to this viewer (named approvers may lack approvals.read).
  const workflowApprovals = <WorkflowApprovalsPanel ctx={viewer.ctx} locale={locale} organizationId={org.id} companyId={company.id} timezone={company.timezone} />;
  const [canRead, canDecide, canRun] = await Promise.all([can(viewer.ctx, "approvals.read", chain), can(viewer.ctx, "approvals.decide", chain), can(viewer.ctx, "agents.run", chain)]);
  if (!canRead) {
    return (
      <div className="mx-auto grid max-w-[1400px] gap-4">
        {header}
        {workflowApprovals}
        <Notice tone="warning">{t("errors.forbidden")}</Notice>
      </div>
    );
  }
  const all = await listApprovals(viewer.ctx, org.id, company.id);
  const now = new Date();
  const pending = all.filter((a) => a.status === "PENDING" && a.expiresAt > now).sort((a, b) => a.expiresAt.getTime() - b.expiresAt.getTime());
  const history = all.filter((a) => !pending.includes(a));
  const outcome = typeof sp.outcome === "string" && (OUTCOMES as readonly string[]).includes(sp.outcome) ? sp.outcome : undefined;
  const shownHistory = history.filter((a) => !outcome || a.status === outcome || (outcome === "EXECUTED" && a.status === "APPROVED"));
  const historyLimit = Math.min(200, Math.max(HISTORY_PAGE, Number(sp.h) || HISTORY_PAGE));
  const visible = [...pending, ...shownHistory.slice(0, historyLimit)];
  const tz = viewer.user.timezone;
  const { previews, names } = await loadDecisionPreviews(visible, { organizationId: org.id, companyId: company.id, t, locale, currency: company.baseCurrency, timeZone: tz });
  const apiBase = `/api/v1/organizations/${org.id}/companies/${company.id}`;
  const lowIds = pending.filter((a) => a.risk === "LOW" && a.autonomy !== "FOUNDER_ONLY").map((a) => a.id);
  const careful = pending.filter((a) => a.risk === "HIGH" || a.risk === "CRITICAL").length;
  const expiringSoon = pending.filter((a) => a.expiresAt.getTime() - now.getTime() < 86_400_000).length;
  const doneWeek = history.filter((a) => a.status === "EXECUTED" && a.executedAt && now.getTime() - a.executedAt.getTime() < 7 * 86_400_000).length;
  const helpTask = canRun ? await latestSubjectTask(viewer.ctx, org.id, company.id, "approvals", company.id) : null;
  const card = (a: (typeof all)[number]) => (
    <DecisionCard key={a.id} a={a} preview={previews.get(a.id)!} t={t} locale={locale} timeZone={tz} apiBase={apiBase} canDecide={canDecide} decidedBy={a.decidedById ? names.get(a.decidedById) : null} />
  );
  const path = `/${locale}/approvals`;
  const chip = (label: string, value: string | undefined) => (
    <Link
      key={label}
      href={value ? `${path}?outcome=${value}` : path}
      aria-current={outcome === value ? "true" : undefined}
      className={cn("rounded-full border px-3 py-1 text-xs", outcome === value ? "border-primary bg-accent font-medium" : "hover:bg-muted")}
    >
      {label}
    </Link>
  );

  return (
    <div className="mx-auto grid max-w-[1400px] gap-4">
      {header}
      <PageIntro
        labels={introLabels(t)}
        accent="warning"
        what={
          <>
            {t("decisionInbox.intro.whatPre")}{" "}
            <Term explain={t("decisionInbox.intro.approvalExplain")} label={t("decisionInbox.intro.whatsThis")}>
              {t("decisionInbox.intro.approvalWord")}
            </Term>
            {t("decisionInbox.intro.whatPost")}
          </>
        }
        why={t("decisionInbox.intro.why")}
        can={t("decisionInbox.intro.can")}
        next={pending.length ? { label: t("decisionInbox.intro.next", { count: pending.length }), href: "#pending" } : { label: t("decisionInbox.intro.nextEmpty"), href: `/${locale}/tasks#composer` }}
      />
      <StatGrid>
        <StatTile index={0} label={t("decisionInbox.stats.waiting")} value={pending.length} icon={<Inbox />} live={pending.length > 0} highlight={pending.length > 0} />
        <StatTile index={1} label={t("decisionInbox.stats.careful")} value={careful} icon={<ShieldAlert />} hint={t("decisionInbox.stats.carefulHint")} />
        <StatTile index={2} label={t("decisionInbox.stats.expiring")} value={expiringSoon} icon={<AlarmClock />} hint={t("decisionInbox.stats.expiringHint")} />
        <StatTile index={3} label={t("decisionInbox.stats.doneWeek")} value={doneWeek} icon={<CheckCircle2 />} />
      </StatGrid>

      {workflowApprovals}

      <section id="pending" className="grid scroll-mt-20 gap-3" aria-labelledby="pending-title">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 id="pending-title" className="text-base font-semibold">
              {t("approvals.pending")}
            </h2>
            <p className="text-xs text-muted-foreground">{t("decisionInbox.pendingHint")}</p>
          </div>
          {canDecide ? <BulkApprove apiBase={apiBase} ids={lowIds} /> : null}
        </div>
        {pending.length ? (
          <div className="grid gap-3 lg:grid-cols-2">{pending.map(card)}</div>
        ) : (
          <Card>
            <SmartEmpty
              icon={<ShieldCheck />}
              title={t("decisionInbox.empty.title")}
              body={t("decisionInbox.empty.body")}
              primary={
                <Button asChild size="sm">
                  <Link href={`/${locale}/tasks#composer`}>{t("decisionInbox.intro.nextEmpty")}</Link>
                </Button>
              }
              ai={
                <Button asChild size="sm" variant="secondary">
                  <Link href={`/${locale}/workforce`}>{t("decisionInbox.empty.autonomy")}</Link>
                </Button>
              }
            />
          </Card>
        )}
      </section>

      {canRun ? (
        <Card variant="glass">
          <CardHeader title={t("decisionInbox.help.title")} description={t("decisionInbox.help.hint")} />
          <CardBody>
            <HelpMeButton
              base={apiBase}
              aiReady={aiConfigured()}
              profile="ai_ceo"
              subject={{ type: "approvals", id: company.id }}
              title="Help me decide on these requests"
              label={t("decisionInbox.help.label")}
              instructions={`The person is a non-technical founder on the Approvals page. These AI requests wait for their decision:\n${pending.slice(0, 25).map((a) => `- [${a.risk}] ${a.summary}${a.requestedByProfile ? ` (asked by ${a.requestedByProfile})` : ""}`).join("\n") || "- none right now"}\nRead the company's objectives and context, then for each request say in plain words whether you would approve or reject it and why (one line each), and flag anything risky. Do not take any action yourself.`}
              initial={helpTask}
            />
          </CardBody>
        </Card>
      ) : null}

      {history.length ? (
        <section className="grid gap-3" aria-labelledby="history-title">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="history-title" className="text-base font-semibold">
              {t("approvals.history")}
            </h2>
            <div className="flex flex-wrap gap-1.5">
              {chip(t("common.all"), undefined)}
              {OUTCOMES.map((o) => chip(t(`decisionInbox.outcome.${o}`), o))}
            </div>
          </div>
          {shownHistory.length ? <div className="grid gap-3 lg:grid-cols-2">{shownHistory.slice(0, historyLimit).map(card)}</div> : <p className="text-sm text-muted-foreground">{t("common.noResults")}</p>}
          {shownHistory.length > historyLimit ? (
            <Link href={`${path}?${new URLSearchParams({ ...(outcome ? { outcome } : {}), h: String(historyLimit + HISTORY_PAGE) })}`} className="justify-self-center text-sm text-primary hover:underline">
              {t("decisionInbox.showMore")}
            </Link>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
