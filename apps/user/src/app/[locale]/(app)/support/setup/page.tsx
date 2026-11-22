import type { Metadata } from "next";
import { areaPage } from "@/components/comms/context";
import { PageIntro } from "@/components/guide-kit/page-intro";
import { introLabels } from "@/components/guide-kit/server";
import { Stepper } from "@/components/guide-kit/stepper";
import { ArticlesStep, ChannelsStep, PromiseStep } from "@/components/support/setup";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { getT } from "@/i18n/server";
import { articleDraftTasks, setupState } from "@/server/modules/support/setup";
import { inboundChannelStatus } from "@/server/modules/support/inbound";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("support.setup.title") };
}

const STEPS = ["channels", "promises", "articles", "inbox"] as const;

/** Reverse-map a stored SLA target to the closest plain-language option (for resuming). */
function nearest<T extends string>(minutes: number | undefined, opts: [T, number][], fallback: T): T {
  if (!minutes) return fallback;
  return opts.reduce((best, o) => (Math.abs(o[1] - minutes) < Math.abs(best[1] - minutes) ? o : best))[0];
}

export default async function SupportSetupPage({ searchParams }: PageProps<"/[locale]/support/setup">) {
  const p = await areaPage("support", "setup", { title: undefined });
  if (p.gate) return p.gate;
  const { locale, t, viewer, org, company, base, perms, wrap } = p;
  if (!perms.manage) return wrap(<Notice tone="warning">{t("support.settings.manageOnly")}</Notice>);
  const sp = await searchParams;
  const state = await setupState(viewer.ctx, org.id, company.id);
  const stored = state.settings.setupStep ?? "channels";
  const reached = stored === "done" ? 2 : Math.max(0, STEPS.indexOf(stored as (typeof STEPS)[number]));
  const asked = typeof sp.step === "string" ? STEPS.indexOf(sp.step as (typeof STEPS)[number]) : -1;
  const current = asked >= 0 && asked <= reached && asked < 3 ? asked : reached;
  const step = STEPS[current]!;
  const inbound = step === "channels" ? await inboundChannelStatus(org.id, company.id, state.settings.supportEmail) : null;
  const drafts = step === "articles" ? await articleDraftTasks(viewer.ctx, org.id, company.id) : [];
  const normal = state.policy?.targets.find((x) => x.priority === "NORMAL");
  const bh = state.policy?.businessHoursOnly ?? true;
  const day = bh ? 480 : 1440;
  return wrap(
    <div className="grid gap-4">
      <PageIntro labels={introLabels(t)} what={t("support.setup.intro.what")} why={t("support.setup.intro.why")} can={t("support.setup.intro.can")} accent="warning" />
      {stored === "done" ? <Notice tone="success">{t("support.setup.alreadyDone")}</Notice> : null}
      <Card variant="elevated">
        <CardHeader title={t(`support.setup.q.${step}`)} description={t(`support.setup.qHint.${step}`)} />
        <CardBody className="grid gap-5">
          <Stepper steps={STEPS.map((k, i) => ({ key: k, label: t(`support.setup.steps.${k}`), href: i < 3 ? `?step=${k}` : `/${locale}/support` }))} current={current} reached={stored === "done" ? 3 : reached} label={t("support.setup.progress")} />
          {step === "channels" ? (
            <ChannelsStep
              base={base}
              emailReady={state.emailReady}
              inbound={inbound!}
              initial={{ supportFormEnabled: state.settings.supportFormEnabled, helpCenterEnabled: state.settings.helpCenterEnabled, emailChannelEnabled: state.settings.emailChannelEnabled, whatsappChannelEnabled: state.settings.whatsappChannelEnabled, supportEmail: state.settings.supportEmail }}
              links={{ form: `/${locale}/support-form/${company.id}`, help: `/${locale}/help/${company.id}` }}
            />
          ) : null}
          {step === "promises" ? (
            <PromiseStep
              base={base}
              initial={{
                respond: nearest(normal?.firstResponseMinutes, [["1h", 60], ["4h", 240], ["1d", day], ["2d", day * 2]], "4h"),
                resolve: nearest(normal?.resolutionMinutes, [["1d", day], ["3d", day * 3], ["1w", bh ? day * 5 : day * 7]], "3d"),
                businessHoursOnly: bh,
              }}
            />
          ) : null}
          {step === "articles" ? <ArticlesStep base={base} locale={locale} aiReady={perms.aiReady && perms.runAgents} drafts={drafts.map((d) => ({ id: d.id, title: d.title, status: d.status, output: d.output, errorMessage: d.errorMessage }))} /> : null}
        </CardBody>
      </Card>
    </div>,
  );
}
