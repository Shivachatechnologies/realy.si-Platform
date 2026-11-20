import type { Metadata } from "next";
import Link from "next/link";
import { ActionButton } from "@/components/crm/kit";
import { AssignmentRulesEditor, CustomFieldsEditor, PipelinesEditor, SourcesEditor, StageRulesEditor } from "@/components/crm/settings-forms";
import { CrmFrame, crmContext } from "@/components/crm/shell";
import { Card, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { getT } from "@/i18n/server";
import { listConfig } from "@/server/modules/crm/config";
import { listPipelines } from "@/server/modules/crm/pipelines";
import { listOwners } from "@/server/modules/crm/service";
import { idealCustomerProfile } from "@/server/modules/crm/guided";
import { IcpEditor } from "@/components/crm/journey-buttons";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("crm.tabs.settings") };
}

const SEGMENT_PATH = { LEAD: "/crm", CONTACT: "/crm/contacts", ACCOUNT: "/crm/accounts", DEAL: "/crm/deals" } as const;

export default async function CrmSettingsPage() {
  const c = await crmContext();
  if (!c.company || !c.canRead) return <CrmFrame active="settings">{null}</CrmFrame>;
  const { t, locale, base, org, company, viewer } = c;
  const ctx = viewer.ctx;
  const [pipelines, owners, sources, fields, segments, assignment, stageRules, icp] = await Promise.all([
    listPipelines(ctx, org.id, company.id),
    listOwners(ctx, org.id, company.id),
    listConfig(ctx, org.id, company.id, "sources"),
    listConfig(ctx, org.id, company.id, "custom-fields"),
    listConfig(ctx, org.id, company.id, "segments"),
    listConfig(ctx, org.id, company.id, "assignment-rules"),
    listConfig(ctx, org.id, company.id, "stage-rules"),
    idealCustomerProfile(ctx, org.id, company.id),
  ]);
  const src = sources as { id: string; name: string }[];
  const stageOptions = pipelines.flatMap((p) => p.stages.map((s) => ({ id: s.id, label: pipelines.length > 1 ? `${p.name} · ${s.name}` : s.name })));
  return (
    <CrmFrame active="settings" subtitle={t("crm.settings.subtitle")}>
      {!c.canManage ? <Notice tone="info">{t("crm.settings.readOnly")}</Notice> : null}
      <Card id="icp">
        <CardHeader
          title={t("crm.settings.icpTitle")}
          description={t("crm.settings.icpHint")}
          actions={
            <Link href={`/${locale}/sales/start`} className="text-xs hover:underline">
              {t("crm.settings.icpGuided")}
            </Link>
          }
        />
        {c.canManage ? (
          <IcpEditor base={base} initial={icp ?? ""} />
        ) : (
          <p className="whitespace-pre-wrap p-4 text-sm">{icp ?? t("crm.settings.icpNone")}</p>
        )}
      </Card>
      <Card>
        <CardHeader title={t("crm.settings.pipelines")} description={t("crm.settings.pipelinesHint")} />
        {c.canManage ? (
          <PipelinesEditor base={base} pipelines={pipelines.map((p) => ({ id: p.id, name: p.name, isDefault: p.isDefault, staleDays: p.staleDays, stages: p.stages.map((s) => ({ id: s.id, name: s.name, probability: s.probability, type: s.type })) }))} />
        ) : (
          <ul className="grid gap-2 p-4 text-sm">
            {pipelines.map((p) => (
              <li key={p.id}>
                <span className="font-medium">{p.name}</span>: {p.stages.map((s) => `${s.name} (${s.probability}%)`).join(" → ")}
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card>
        <CardHeader title={t("crm.settings.sources")} description={t("crm.settings.sourcesHint")} />
        {c.canManage ? <SourcesEditor base={base} sources={src} /> : <p className="p-4 text-sm">{src.map((s) => s.name).join(", ") || "—"}</p>}
      </Card>
      <Card>
        <CardHeader title={t("crm.settings.customFields")} description={t("crm.settings.customFieldsHint")} />
        {c.canManage ? <CustomFieldsEditor base={base} fields={fields as { id: string; entity: string; key: string; label: string; type: string; options: string[]; required: boolean }[]} /> : null}
      </Card>
      <Card>
        <CardHeader title={t("crm.settings.assignmentRules")} description={t("crm.settings.assignmentRulesHint")} />
        {c.canManage ? (
          <AssignmentRulesEditor
            base={base}
            owners={owners}
            sources={src.map((s) => s.name)}
            rules={assignment as { id: string; name: string; strategy: string; ownerIds: string[]; matchSource: string | null; matchTerritory: string | null; active: boolean; assignedCount: number; followUpDays: number | null }[]}
          />
        ) : null}
      </Card>
      <Card>
        <CardHeader title={t("crm.settings.stageRules")} description={t("crm.settings.stageRulesHint")} />
        {c.canManage ? (
          <StageRulesEditor
            base={base}
            stages={stageOptions}
            rules={(stageRules as { id: string; name: string; createFollowUp: boolean; followUpDays: number; createWorkTask: boolean; notifyOwner: boolean; active: boolean; stage: { name: string; pipeline: { name: string } } }[]).map((r) => ({
              ...r,
              stageLabel: pipelines.length > 1 ? `${r.stage.pipeline.name} · ${r.stage.name}` : r.stage.name,
            }))}
          />
        ) : null}
      </Card>
      <Card>
        <CardHeader title={t("crm.segments.title")} description={t("crm.segments.hint")} />
        {(segments as { id: string; name: string; entity: keyof typeof SEGMENT_PATH; filters: Record<string, string> }[]).length ? (
          <ul className="grid divide-y text-sm">
            {(segments as { id: string; name: string; entity: keyof typeof SEGMENT_PATH; filters: Record<string, string> }[]).map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-2 px-4 py-2">
                <Link href={`/${locale}${SEGMENT_PATH[s.entity]}?${new URLSearchParams(s.filters)}`} className="font-medium hover:underline">
                  {s.name}
                </Link>
                <span className="flex-1 text-xs text-muted-foreground">{t(`crm.entities.${s.entity}`)}</span>
                <ActionButton url={`${base}/crm/settings/segments/${s.id}`} method="DELETE" size="icon" icon="trash" label={t("crm.delete")} confirm={t("crm.deleteConfirm")} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="p-4 text-sm text-muted-foreground">{t("crm.segments.none")}</p>
        )}
      </Card>
    </CrmFrame>
  );
}
