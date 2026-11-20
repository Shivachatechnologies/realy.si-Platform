import type { Metadata } from "next";
import { PageIntro } from "@/components/guide-kit/page-intro";
import { introLabels } from "@/components/guide-kit/server";
import { Card, CardHeader } from "@/components/ui/card";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { workContext } from "@/components/work/context";
import { DeleteIconButton } from "@/components/work/task-forms";
import { ProjectsAreaTabs } from "@/components/work/views";
import { getT } from "@/i18n/server";
import { formatDate } from "@/i18n/format";
import { listTemplates } from "@/server/modules/work/projects";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("work.tabs.templates") };
}

export default async function TemplatesPage() {
  const t = await getT();
  const w = await workContext("projects", t("modules.projects.title"), t("work.projectsSubtitle"));
  if (w.gate) return w.gate;
  const { locale, viewer, org, company, canManage, base, tz } = w;
  const tpl = await listTemplates(viewer.ctx, org.id, company.id);
  return (
    <div className="mx-auto grid max-w-[1400px] min-w-0 gap-4">
      {w.header}
      <ProjectsAreaTabs t={t} locale={locale} active="templates" />
      <PageIntro labels={introLabels(t)} what={t("work.intro.templates.what")} why={t("work.intro.templates.why")} can={t("work.intro.templates.can")} next={{ label: t("work.intro.templates.next"), href: `/${locale}/projects/start` }} accent="info" />
      <Card>
        <CardHeader title={t("work.template.builtIn")} description={t("work.template.builtInHint")} />
        <ul className="grid divide-y">
          {tpl.builtIn
            .filter((b) => b.key !== "blank")
            .map((b) => (
              <li key={b.key} className="grid gap-0.5 px-4 py-3 text-sm">
                <span className="font-medium">{t(`work.templates.builtIn.${b.key}.name`)}</span>
                <span className="text-muted-foreground">{t(`work.templates.builtIn.${b.key}.description`)}</span>
                <span className="text-xs text-muted-foreground">{t("work.template.counts", { tasks: b.tasks, milestones: b.milestones })}</span>
              </li>
            ))}
        </ul>
      </Card>
      <Card>
        <CardHeader title={t("work.template.custom")} description={t("work.template.customHint")} />
        {tpl.custom.length ? (
          <Table>
            <THead>
              <Tr>
                <Th>{t("work.template.name")}</Th>
                <Th>{t("work.template.description")}</Th>
                <Th>{t("work.template.contents")}</Th>
                <Th>{t("projects.created")}</Th>
                {canManage ? <Th className="w-10" /> : null}
              </Tr>
            </THead>
            <TBody>
              {tpl.custom.map((c) => (
                <Tr key={c.id}>
                  <Td className="font-medium">{c.name}</Td>
                  <Td className="text-muted-foreground">{c.description ?? "—"}</Td>
                  <Td className="text-muted-foreground">{t("work.template.counts", { tasks: c.tasks, milestones: c.milestones })}</Td>
                  <Td className="whitespace-nowrap text-muted-foreground">{formatDate(c.createdAt, locale, tz)}</Td>
                  {canManage ? (
                    <Td>
                      <DeleteIconButton url={`${base}/templates/${c.id}`} label={t("work.delete")} confirm={t("work.confirmDelete")} />
                    </Td>
                  ) : null}
                </Tr>
              ))}
            </TBody>
          </Table>
        ) : (
          <p className="p-4 text-sm text-muted-foreground">{t("work.template.empty")}</p>
        )}
      </Card>
    </div>
  );
}
