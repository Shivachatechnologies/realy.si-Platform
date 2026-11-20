import type { Metadata } from "next";
import Link from "next/link";
import { workflowsPage } from "@/components/automation/frame";
import { FlowView } from "@/components/automation/flow-view";
import { eventLabelKey } from "@/components/automation/labels";
import { NewWorkflowForm } from "@/components/automation/workflow-forms";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { getT } from "@/i18n/server";
import { cn } from "@/lib/utils";
import { flattenSteps } from "@/server/modules/automation/definition";
import { WORKFLOW_TEMPLATES, type WorkflowTemplate } from "@/server/modules/automation/templates";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("workflows.tabs.templates") };
}

const AI_KINDS = new Set(["assign_ai_employee", "ai_employee_task", "generate_ai_content", "decompose_goal", "ai_decision"]);

export default async function TemplatesPage({ searchParams }: PageProps<"/[locale]/workflows/templates">) {
  const p = await workflowsPage("templates");
  if (p.page) return p.page;
  const { locale, t, canManage, base } = p.ctx;
  const sp = await searchParams;
  const categories = [...new Set(WORKFLOW_TEMPLATES.map((x) => x.category))] as WorkflowTemplate["category"][];
  const active = typeof sp.category === "string" && (categories as string[]).includes(sp.category) ? sp.category : null;
  const shown = WORKFLOW_TEMPLATES.filter((x) => !active || x.category === active);
  const templates = WORKFLOW_TEMPLATES.map((x) => ({ key: x.key, name: t(`workflows.templates.${x.key}.name`) }));
  const path = `/${locale}/workflows/templates`;
  return p.render(
    <div className="grid gap-4">
      <nav className="flex flex-wrap gap-1.5" aria-label={t("workflows.gallery.categories")}>
        {[null, ...categories].map((c) => (
          <Link
            key={c ?? "all"}
            href={c ? `${path}?category=${c}` : path}
            aria-current={active === c ? "page" : undefined}
            className={cn("inline-flex min-h-9 items-center rounded-full border px-3.5 text-sm transition-colors", active === c ? "border-primary bg-primary/10 font-medium text-primary" : "hover:border-primary/40")}
          >
            {c ? t(`workflows.templateCategories.${c}`) : t("workflows.gallery.all")}
            <span className="ms-1.5 text-xs text-muted-foreground tabular-nums">{c ? WORKFLOW_TEMPLATES.filter((x) => x.category === c).length : WORKFLOW_TEMPLATES.length}</span>
          </Link>
        ))}
      </nav>
      <ul className="grid gap-4 md:grid-cols-2">
        {shown.map((tpl) => {
          const tr = tpl.definition.trigger;
          const steps = flattenSteps(tpl.definition.steps);
          const usesAi = steps.some((s) => s.type === "action" && AI_KINDS.has(s.action.kind));
          const approval = steps.some((s) => s.type === "action" && s.action.kind === "request_approval");
          return (
            <li key={tpl.key}>
              <Card className="flex h-full flex-col" interactive>
                <CardHeader
                  title={t(`workflows.templates.${tpl.key}.name`)}
                  description={t(`workflows.templates.${tpl.key}.description`)}
                  actions={<Badge>{t(`workflows.templateCategories.${tpl.category}`)}</Badge>}
                />
                <div className="flex flex-wrap items-center gap-1.5 px-4 text-xs">
                  <Badge tone="info" shape="pill">
                    {tr.type === "event" ? t(eventLabelKey(tr.event)) : t(`workflows.builder.triggerTypes.${tr.type}`)}
                  </Badge>
                  <Badge shape="pill">{t("workflows.gallery.steps", { count: steps.length })}</Badge>
                  {usesAi ? (
                    <Badge tone="brand" shape="pill">
                      {t("workflows.flow.badgeAi")}
                    </Badge>
                  ) : null}
                  {approval ? (
                    <Badge tone="warning" shape="pill">
                      {t("workflows.flow.badgeApproval")}
                    </Badge>
                  ) : null}
                </div>
                <details className="group mt-3 border-t">
                  <summary className="flex min-h-11 cursor-pointer items-center px-4 text-sm font-medium text-primary">{t("workflows.gallery.preview")}</summary>
                  <div className="px-4 pb-4">
                    <FlowView definition={tpl.definition} />
                  </div>
                </details>
                {canManage ? (
                  <details className="mt-auto border-t">
                    <summary className="flex min-h-11 cursor-pointer items-center px-4 text-sm font-medium">{t("workflows.useTemplate")}</summary>
                    <NewWorkflowForm base={base} locale={locale} templates={templates} defaultTemplate={tpl.key} />
                  </details>
                ) : null}
              </Card>
            </li>
          );
        })}
      </ul>
    </div>,
  );
}
