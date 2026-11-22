import type { Metadata } from "next";
import { PageIntro } from "@/components/guide-kit/page-intro";
import { introLabels } from "@/components/guide-kit/server";
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { ActionButton } from "@/components/comms/client";
import { areaPage } from "@/components/comms/context";
import { AssignmentRuleForm, CategoriesManager, EscalationRuleForm, InboundChannelSettings, PolicyRowView, RuleActiveToggle, SettingsToggles, SlaPolicyForm } from "@/components/support/settings";
import { getT } from "@/i18n/server";
import { AiManagerStrip } from "@/components/work/ai-manager";
import { departmentManager } from "@/server/modules/cockpit/department-manager";
import { listAgents } from "@/server/modules/support/common";
import { getSettings, listAssignmentRules, listCategories, listEscalationRules, listSlaPolicies } from "@/server/modules/support/config";
import { inboundChannelStatus } from "@/server/modules/support/inbound";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("support.settings.title") };
}

export default async function SupportSettingsPage() {
  const p = await areaPage("support", "settings");
  if (p.gate) return p.gate;
  const { locale, t, viewer, org, company, base, perms, wrap } = p;
  const [settings, categories, policies, assignment, escalation, agents] = await Promise.all([
    getSettings(viewer.ctx, org.id, company.id),
    listCategories(viewer.ctx, org.id, company.id),
    listSlaPolicies(viewer.ctx, org.id, company.id),
    listAssignmentRules(viewer.ctx, org.id, company.id),
    listEscalationRules(viewer.ctx, org.id, company.id),
    listAgents(viewer.ctx, org.id, company.id),
  ]);
  const manager = await departmentManager(company.id, ["support_agent", "support_lead"]);
  const inbound = await inboundChannelStatus(org.id, company.id, settings.supportEmail);
  if (!perms.manage) return wrap(<Notice tone="warning">{t("support.settings.manageOnly")}</Notice>);
  const agentName = new Map(agents.map((a) => [a.id, a.name]));
  const categoryName = new Map(categories.map((c) => [c.id, c.name]));
  return wrap(
    <>
    <PageIntro labels={introLabels(t)} what={t("support.intro.settings.what")} why={t("support.intro.settings.why")} can={t("support.intro.settings.can")} next={{ label: t("support.intro.settings.next"), href: `/${locale}/support/setup` }} accent="warning" />
    <AiManagerStrip t={t} locale={locale} manager={manager} duty={t("support.settings.aiDuty")} />
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader title={t("support.settings.channels")} description={t("support.settings.channelsHint")} />
        <CardBody className="grid gap-3">
          <SettingsToggles base={base} settings={settings} />
          <div className="grid gap-1 text-sm">
            <Link href={`/${locale}/help/${company.id}`} target="_blank" className="flex items-center gap-1 underline">
              <ExternalLink className="size-3.5" aria-hidden /> {t("support.settings.helpCenterLink")}
            </Link>
            <Link href={`/${locale}/support-form/${company.id}`} target="_blank" className="flex items-center gap-1 underline">
              <ExternalLink className="size-3.5" aria-hidden /> {t("support.settings.formLink")}
            </Link>
          </div>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title={t("support.settings.inbound")} description={t("support.settings.inboundHint")} />
        <CardBody>
          <InboundChannelSettings base={base} settings={{ emailChannelEnabled: settings.emailChannelEnabled, whatsappChannelEnabled: settings.whatsappChannelEnabled, supportEmail: settings.supportEmail }} status={inbound} />
        </CardBody>
      </Card>
      <Card>
        <CardHeader title={t("support.settings.categories")} description={t("support.settings.categoriesHint")} />
        <CardBody>
          <CategoriesManager base={base} categories={categories.map((c) => ({ id: c.id, name: c.name, description: c.description, keywords: c.keywords, defaultPriority: c.defaultPriority, count: c._count.tickets }))} />
        </CardBody>
      </Card>
      <Card className="lg:col-span-2">
        <CardHeader title={t("support.settings.slaPolicies")} description={t("support.settings.slaHint")} />
        <CardBody className="grid gap-3">
          {policies.length ? (
            <ul className="grid divide-y">
              {policies.map((pol) => (
                <PolicyRowView key={pol.id} base={base} policy={pol} />
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">{t("support.settings.noPolicies")}</p>
          )}
          <details className="rounded-md border p-3">
            <summary className="cursor-pointer text-sm font-medium">{t("support.settings.addPolicy")}</summary>
            <div className="pt-3">
              <SlaPolicyForm base={base} />
            </div>
          </details>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title={t("support.settings.assignmentRules")} description={t("support.settings.assignmentHint")} />
        <CardBody className="grid gap-3">
          {assignment.length ? (
            <ul className="grid divide-y">
              {assignment.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                  <span className="text-xs tabular-nums text-muted-foreground">{r.position}</span>
                  <span className="font-medium">{r.name}</span>
                  <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                    {t(`support.settings.strategies.${r.strategy}`)}
                    {r.categoryId ? ` · ${categoryName.get(r.categoryId) ?? "?"}` : ""} · {r.assigneeIds.map((a) => agentName.get(a) ?? "?").join(", ")}
                  </span>
                  <RuleActiveToggle path={`${base}/support/assignment-rules/${r.id}`} rule={{ name: r.name, strategy: r.strategy, categoryId: r.categoryId, assigneeIds: r.assigneeIds, position: r.position, active: r.active }} />
                  <ActionButton path={`${base}/support/assignment-rules/${r.id}`} method="DELETE" variant="ghost" confirm={t("communication.confirmDelete")}>
                    {t("communication.delete")}
                  </ActionButton>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">{t("support.settings.noAssignmentRules")}</p>
          )}
          <AssignmentRuleForm base={base} agents={agents} categories={categories.map((c) => ({ id: c.id, name: c.name }))} />
        </CardBody>
      </Card>
      <Card>
        <CardHeader title={t("support.settings.escalationRules")} description={t("support.settings.escalationHint")} />
        <CardBody className="grid gap-3">
          {escalation.length ? (
            <ul className="grid divide-y">
              {escalation.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                  <span className="font-medium">{r.name}</span>
                  <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                    {t(`support.settings.triggers.${r.trigger}`)}
                    {r.raisePriority ? ` · ${t("support.settings.raisePriority")}` : ""}
                    {r.reassignToId ? ` · ${t("support.settings.reassignToName", { name: agentName.get(r.reassignToId) ?? "?" })}` : ""}
                    {r.notifyManagers ? ` · ${t("support.settings.notifyManagers")}` : ""}
                  </span>
                  <RuleActiveToggle path={`${base}/support/escalation-rules/${r.id}`} rule={{ name: r.name, trigger: r.trigger, raisePriority: r.raisePriority, reassignToId: r.reassignToId, notifyManagers: r.notifyManagers, active: r.active }} />
                  <ActionButton path={`${base}/support/escalation-rules/${r.id}`} method="DELETE" variant="ghost" confirm={t("communication.confirmDelete")}>
                    {t("communication.delete")}
                  </ActionButton>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">{t("support.settings.noEscalationRules")}</p>
          )}
          <EscalationRuleForm base={base} agents={agents} />
        </CardBody>
      </Card>
    </div>
    </>,
  );
}
