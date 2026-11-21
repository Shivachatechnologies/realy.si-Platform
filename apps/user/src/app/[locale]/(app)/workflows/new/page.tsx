import type { Metadata } from "next";
import Link from "next/link";
import { Bot, Settings2, Wand2 } from "lucide-react";
import { workflowsPage } from "@/components/automation/frame";
import { NlComposer } from "@/components/automation/nl-composer";
import { DescribeIt, SimpleBuilder } from "@/components/automation/simple-builder";
import { PageIntro } from "@/components/guide-kit/page-intro";
import { introLabels } from "@/components/guide-kit/server";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { getT } from "@/i18n/server";
import { db } from "@/server/core/db";
import { AGENT_PROFILES } from "@/server/modules/agents/profiles";
import { aiConfigured } from "@/server/modules/agents/runtime";
import { can } from "@/server/modules/rbac/service";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("workflows.simple.title") };
}

export default async function NewAutomationPage() {
  const p = await workflowsPage(null, { title: undefined });
  if (p.page) return p.page;
  const { locale, t, viewer, org, company, chain, canManage, base } = p.ctx;
  if (!canManage) return p.render(<Notice tone="warning">{t("workflows.simple.manageOnly")}</Notice>, false);
  const [members, canRunAgents] = await Promise.all([
    db().membership.findMany({ where: { organizationId: org.id, status: "ACTIVE", user: { status: "ACTIVE" } }, select: { user: { select: { id: true, name: true } } }, orderBy: { user: { name: "asc" } } }),
    can(viewer.ctx, "agents.run", chain),
  ]);
  const label = (key: string, fallback: string) => {
    const v = t(key);
    return v === key ? fallback : v;
  };
  return p.render(
    <div className="grid gap-4">
      <PageIntro labels={introLabels(t)} what={t("workflows.simple.intro.what")} why={t("workflows.simple.intro.why")} can={t("workflows.simple.intro.can")} accent="primary" />
      <Card variant="highlight">
        <CardHeader title={t("workflows.compose.title")} description={t("workflows.compose.hint")} icon={<Wand2 />} />
        <CardBody>
          <NlComposer base={base} />
        </CardBody>
      </Card>
      <Card variant="elevated">
        <CardHeader
          title={t("workflows.simple.builderTitle")}
          description={t("workflows.simple.builderHint")}
          actions={
            <Link href={`/${locale}/workflows?advanced=1`} className={buttonVariants({ size: "sm", variant: "ghost" })}>
              <Settings2 aria-hidden /> {t("workflows.simple.advanced")}
            </Link>
          }
        />
        <CardBody>
          <SimpleBuilder
            base={base}
            users={members.map((m) => m.user)}
            meId={viewer.user.id}
            currency={company.baseCurrency}
            profiles={AGENT_PROFILES.map((x) => ({ key: x.key, name: label(`profiles.${x.key}.name`, x.key) }))}
          />
        </CardBody>
      </Card>
      <Card>
        <CardHeader title={t("workflows.compose.architectTitle")} description={t("workflows.compose.architectHint")} icon={<Bot />} />
        <CardBody>
          <DescribeIt base={base} aiReady={aiConfigured() && canRunAgents} />
        </CardBody>
      </Card>
    </div>,
    false,
  );
}
