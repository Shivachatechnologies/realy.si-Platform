import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { HrForm } from "@/components/hr/hr-form";
import { enumOptions } from "@/components/hr/options";
import { HrFrame, loadHr, personName } from "@/components/hr/shell";
import { formatDateTime } from "@/i18n/format";
import { getLocale, getT } from "@/i18n/server";
import { isAppError } from "@/server/core/errors";
import { interviewForScorecard, RECOMMENDATIONS, SCORECARD_CRITERIA } from "@/server/modules/hr/recruiting";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("hr.recruiting.addScorecard") };
}

/** Scorecard form for an interviewer (needs only hr.read and to be on the interview). */
export default async function InterviewScorecardPage({ params }: { params: Promise<{ interviewId: string }> }) {
  const { interviewId } = await params;
  const locale = await getLocale();
  const { t, viewer, org, company, access, base, tz } = await loadHr(locale);
  const allowed = !!access?.read;
  const frame = { t, locale, title: t("hr.recruiting.addScorecard"), tab: "me" as const, access, hasCompany: !!company, allowed };
  if (!company || !allowed) return <HrFrame {...frame}>{null}</HrFrame>;
  const iv = await interviewForScorecard(viewer.ctx, org.id, company.id, interviewId).catch((err) => {
    if (isAppError(err) && (err.code === "not_found" || err.code === "forbidden")) notFound();
    throw err;
  });
  return (
    <HrFrame {...frame} subtitle={`${personName(iv.candidate)} · ${iv.candidate.job.title} · ${formatDateTime(iv.scheduledAt, locale, tz)}`}>
      <Card className="max-w-2xl">
        <CardHeader title={t(`hr.interviewType.${iv.type}`)} />
        <CardBody>
          <HrForm
            endpoint={`${base}/hr/candidates/${iv.candidate.id}/scorecards`}
            extra={{ interviewId: iv.id }}
            redirectTo="/hr/me"
            fields={[
              ...SCORECARD_CRITERIA.map((k) => ({ name: `ratings.${k}`, label: t(`hr.criteria.${k}`), type: "number" as const, min: 1, max: 5 })),
              { name: "recommendation", label: t("hr.recruiting.recommendationLabel"), type: "select", required: true, options: enumOptions(t, "hr.recommendation", RECOMMENDATIONS) },
              { name: "comments", label: t("hr.perf.comments"), type: "textarea", rows: 4 },
            ]}
            initial={{ recommendation: "YES" }}
            submitLabel={t("hr.recruiting.submitScorecard")}
          />
        </CardBody>
      </Card>
    </HrFrame>
  );
}
