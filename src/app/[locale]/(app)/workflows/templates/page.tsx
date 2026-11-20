import type { Metadata } from "next";
import { workflowsPage } from "@/components/automation/frame";
import { eventLabelKey } from "@/components/automation/labels";
import { NewWorkflowForm } from "@/components/automation/workflow-forms";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { getT } from "@/i18n/server";
import { flattenSteps } from "@/server/modules/automation/definition";
import { WORKFLOW_TEMPLATES } from "@/server/modules/automation/templates";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("workflows.tabs.templates") };
}

export default async function TemplatesPage() {
  const p = await workflowsPage("templates");
  if (p.page) return p.page;
  const { locale, t, canManage, base } = p.ctx;
  const templates = WORKFLOW_TEMPLATES.map((x) => ({ key: x.key, name: t(`workflows.templates.${x.key}.name`) }));
  return p.render(
    <ul className="grid gap-3 md:grid-cols-2">
      {WORKFLOW_TEMPLATES.map((tpl) => {
        const tr = tpl.definition.trigger;
        const steps = flattenSteps(tpl.definition.steps);
        return (
          <li key={tpl.key}>
            <Card className="h-full">
              <CardHeader title={t(`workflows.templates.${tpl.key}.name`)} description={t(`workflows.templates.${tpl.key}.description`)} actions={<Badge>{t(`workflows.templateCategories.${tpl.category}`)}</Badge>} />
              <div className="grid gap-2 p-4 text-sm">
                <p>
                  <span className="text-muted-foreground">{t("workflows.trigger")}: </span>
                  {tr.type === "event" ? t(eventLabelKey(tr.event)) : t(`workflows.builder.triggerTypes.${tr.type}`)}
                </p>
                <ol className="grid gap-1 ps-4 text-muted-foreground [list-style:decimal]">
                  {steps.map((s) => (
                    <li key={s.id}>{s.type === "action" ? t(`workflows.builder.actions.${s.action.kind}`) : t(`workflows.builder.stepTypes.${s.type}`)}</li>
                  ))}
                </ol>
              </div>
              {canManage ? (
                <details className="border-t">
                  <summary className="cursor-pointer p-3 text-sm font-medium">{t("workflows.useTemplate")}</summary>
                  <NewWorkflowForm base={base} locale={locale} templates={templates} defaultTemplate={tpl.key} />
                </details>
              ) : null}
            </Card>
          </li>
        );
      })}
    </ul>,
  );
}
