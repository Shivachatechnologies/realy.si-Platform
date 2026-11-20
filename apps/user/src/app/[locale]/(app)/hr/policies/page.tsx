import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { AiPanel } from "@/components/hr/ai-panel";
import { HrForm } from "@/components/hr/hr-form";
import { enumOptions } from "@/components/hr/options";
import { HrFrame, loadHr } from "@/components/hr/shell";
import { formatDate } from "@/i18n/format";
import { getLocale, getT } from "@/i18n/server";
import { listSubjectTasks } from "@/server/modules/agents/service";
import { listPolicies, POLICY_CATEGORIES } from "@/server/modules/hr/policies";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("hr.tabs.policies") };
}

export default async function PoliciesPage() {
  const locale = await getLocale();
  const { t, viewer, org, company, access, base, tz } = await loadHr(locale);
  const allowed = !!access?.read;
  const frame = { t, locale, title: t("hr.policies.title"), subtitle: t("hr.policies.subtitle"), tab: "policies" as const, access, hasCompany: !!company, allowed };
  if (!company || !allowed) return <HrFrame {...frame}>{null}</HrFrame>;
  const [policies, tasks] = await Promise.all([
    listPolicies(viewer.ctx, org.id, company.id),
    access!.agentsRun ? listSubjectTasks(viewer.ctx, org.id, company.id, "hr_policy_qa", company.id, 5).catch(() => []) : Promise.resolve([]),
  ]);
  const manage = access!.manage;
  return (
    <HrFrame {...frame}>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader title={t("hr.policies.list")} description={t("hr.policies.count", { count: policies.length })} />
          {policies.length ? (
            <ul className="grid divide-y">
              {policies.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                  <Link href={`/${locale}/hr/policies/${p.id}`} className="font-medium hover:underline">
                    {p.title}
                  </Link>
                  <Badge>{t(`hr.policyCategory.${p.category}`)}</Badge>
                  <span className="text-xs text-muted-foreground">v{p.version}</span>
                  {!p.publishedAt ? <Badge tone="warning">{t("hr.policies.draft")}</Badge> : null}
                  <span className="ms-auto flex items-center gap-2 text-xs">
                    {manage && p.publishedAt && p.requiresAck ? <span className="text-muted-foreground">{t("hr.policies.acked", { count: p.ackCount, total: p.headcount })}</span> : null}
                    {access!.me && p.publishedAt && p.requiresAck ? (
                      p.myAck ? <Badge tone="success">{t("hr.policies.youAcked", { date: formatDate(p.myAck.acknowledgedAt, locale, tz) })}</Badge> : <Badge tone="warning">{t("hr.policies.needsAck")}</Badge>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="p-4 text-sm text-muted-foreground">{t("hr.policies.empty")}</p>
          )}
          {manage ? (
            <details className="border-t">
              <summary className="cursor-pointer p-3 text-sm font-medium">{t("hr.policies.add")}</summary>
              <HrForm
                className="px-3 pb-3"
                endpoint={`${base}/hr/policies`}
                redirectTo="/hr/policies/:id"
                fields={[
                  { name: "title", label: t("hr.policies.titleLabel"), required: true },
                  { name: "category", label: t("hr.policies.category"), type: "select", required: true, options: enumOptions(t, "hr.policyCategory", POLICY_CATEGORIES) },
                  { name: "body", label: t("hr.policies.body"), type: "textarea", rows: 10, required: true },
                  { name: "requiresAck", label: t("hr.policies.requiresAck"), type: "checkbox", hint: t("hr.policies.requiresAckHint") },
                  { name: "publish", label: t("hr.policies.publishNow"), type: "checkbox", hint: t("hr.policies.publishHint") },
                ]}
                initial={{ category: "general", requiresAck: true }}
                submitLabel={t("common.create")}
              />
            </details>
          ) : null}
        </Card>
        {access!.agentsRun ? (
          <div className="grid content-start gap-3">
            <Card>
              <CardHeader title={t("hr.ai.policyTitle")} description={t("hr.ai.policyHint")} />
              <CardBody>
                <HrForm endpoint={`${base}/hr/assist/policy`} columns={1} fields={[{ name: "question", label: t("hr.ai.question"), type: "textarea", rows: 2, required: true, placeholder: t("hr.ai.policyPlaceholder") }]} submitLabel={t("hr.ai.ask")} />
              </CardBody>
            </Card>
            <AiPanel t={t} locale={locale} tz={tz} title={t("hr.ai.policyAnswers")} description={t("hr.ai.policyAnswersHint")} actions={[]} tasks={tasks} canRun={false} />
          </div>
        ) : null}
      </div>
    </HrFrame>
  );
}
