import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ActionButton } from "@/components/hr/hr-action";
import { HrForm } from "@/components/hr/hr-form";
import { enumOptions } from "@/components/hr/options";
import { HrFrame, loadHr, personName } from "@/components/hr/shell";
import { formatDate, formatDateTime } from "@/i18n/format";
import { getLocale, getT } from "@/i18n/server";
import { isAppError } from "@/server/core/errors";
import { getPolicy, POLICY_CATEGORIES } from "@/server/modules/hr/policies";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("hr.policies.policy") };
}

export default async function PolicyPage({ params }: { params: Promise<{ policyId: string }> }) {
  const { policyId } = await params;
  const locale = await getLocale();
  const { t, viewer, org, company, access, base, tz } = await loadHr(locale);
  const allowed = !!access?.read;
  const frame = { t, locale, title: t("hr.policies.policy"), tab: "policies" as const, access, hasCompany: !!company, allowed };
  if (!company || !allowed) return <HrFrame {...frame}>{null}</HrFrame>;
  const p = await getPolicy(viewer.ctx, org.id, company.id, policyId).catch((err) => {
    if (isAppError(err) && err.code === "not_found") notFound();
    throw err;
  });
  const acked = p.tracking.filter((x) => x.acknowledgedAt).length;
  return (
    <HrFrame
      {...frame}
      title={p.title}
      subtitle={`${t(`hr.policyCategory.${p.category}`)} · v${p.version}${p.publishedAt ? ` · ${t("hr.policies.publishedOn", { date: formatDate(p.publishedAt, locale, tz) })}` : ""}`}
      actions={
        <>
          {!p.publishedAt ? <Badge tone="warning">{t("hr.policies.draft")}</Badge> : null}
          {p.manage && !p.publishedAt ? <ActionButton endpoint={`${base}/hr/policies/${p.id}`} method="PATCH" body={{ publish: true }} label={t("hr.policies.publish")} variant="default" /> : null}
          {p.manage && p.publishedAt ? <ActionButton endpoint={`${base}/hr/policies/${p.id}`} method="PATCH" body={{ publish: false }} label={t("hr.policies.unpublish")} /> : null}
          {p.manage ? <ActionButton endpoint={`${base}/hr/policies/${p.id}`} method="DELETE" label={t("hr.archive")} variant="ghost" confirm={t("hr.confirmArchive")} redirectTo="/hr/policies" /> : null}
          <Link href={`/${locale}/hr/policies`} className="text-sm text-muted-foreground hover:underline">
            {t("hr.policies.back")}
          </Link>
        </>
      }
    >
      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card>
          <CardBody>
            <div className="whitespace-pre-wrap text-sm leading-relaxed">{p.body}</div>
            {p.canAck ? (
              <div className="mt-4 border-t pt-3">
                {p.myAck ? (
                  <Badge tone="success">{t("hr.policies.youAcked", { date: formatDateTime(p.myAck.acknowledgedAt, locale, tz) })}</Badge>
                ) : (
                  <ActionButton endpoint={`${base}/hr/policies/${p.id}/acknowledge`} label={t("hr.policies.acknowledge")} variant="default" />
                )}
              </div>
            ) : null}
          </CardBody>
        </Card>
        {p.manage ? (
          <div className="grid content-start gap-4">
            {p.publishedAt && p.requiresAck ? (
              <Card>
                <CardHeader title={t("hr.policies.tracking")} description={t("hr.policies.acked", { count: acked, total: p.tracking.length })} />
                <CardBody>
                  <ul className="grid max-h-96 gap-1 overflow-y-auto text-sm">
                    {p.tracking.map((x) => (
                      <li key={x.employee.id} className="flex items-center justify-between gap-2">
                        <span>{personName(x.employee)}</span>
                        {x.acknowledgedAt ? <span className="text-xs text-success">{formatDate(x.acknowledgedAt, locale, tz)}</span> : <Badge tone="warning">{t("hr.policies.pending")}</Badge>}
                      </li>
                    ))}
                  </ul>
                </CardBody>
              </Card>
            ) : null}
            <Card>
              <CardHeader title={t("hr.edit")} description={t("hr.policies.versionHint")} />
              <CardBody>
                <HrForm
                  columns={1}
                  method="PATCH"
                  endpoint={`${base}/hr/policies/${p.id}`}
                  fields={[
                    { name: "title", label: t("hr.policies.titleLabel"), required: true },
                    { name: "category", label: t("hr.policies.category"), type: "select", required: true, options: enumOptions(t, "hr.policyCategory", POLICY_CATEGORIES) },
                    { name: "body", label: t("hr.policies.body"), type: "textarea", rows: 12, required: true },
                    { name: "requiresAck", label: t("hr.policies.requiresAck"), type: "checkbox", hint: t("hr.policies.requiresAckHint") },
                  ]}
                  initial={{ title: p.title, category: p.category, body: p.body, requiresAck: p.requiresAck }}
                  submitLabel={t("common.save")}
                />
              </CardBody>
            </Card>
          </div>
        ) : null}
      </div>
    </HrFrame>
  );
}
