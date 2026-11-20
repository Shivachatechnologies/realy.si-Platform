import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { ActionButton } from "@/components/hr/hr-action";
import { HrFrame, loadHr, personName } from "@/components/hr/shell";
import { formatDate } from "@/i18n/format";
import { getLocale, getT } from "@/i18n/server";
import { isAppError } from "@/server/core/errors";
import { getCycle } from "@/server/modules/hr/performance";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("hr.perf.cycle") };
}

export default async function CyclePage({ params }: { params: Promise<{ cycleId: string }> }) {
  const { cycleId } = await params;
  const locale = await getLocale();
  const { t, viewer, org, company, access, base } = await loadHr(locale);
  const allowed = !!access?.manage;
  const frame = { t, locale, title: t("hr.perf.cycle"), tab: "performance" as const, access, hasCompany: !!company, allowed };
  if (!company || !allowed) return <HrFrame {...frame}>{null}</HrFrame>;
  const c = await getCycle(viewer.ctx, org.id, company.id, cycleId).catch((err) => {
    if (isAppError(err) && err.code === "not_found") notFound();
    throw err;
  });
  const done = c.reviews.filter((r) => r.status === "COMPLETED").length;
  return (
    <HrFrame
      {...frame}
      title={c.name}
      subtitle={`${formatDate(c.startDate, locale, "UTC")} – ${formatDate(c.endDate, locale, "UTC")}`}
      actions={
        <>
          <Badge tone={c.status === "ACTIVE" ? "accent" : c.status === "CLOSED" ? "success" : "neutral"}>{t(`hr.cycleStatus.${c.status}`)}</Badge>
          {c.status === "DRAFT" ? <ActionButton endpoint={`${base}/hr/review-cycles/${c.id}`} method="PATCH" body={{ status: "ACTIVE" }} label={t("hr.perf.launch")} variant="default" confirm={t("hr.perf.launchConfirm")} /> : null}
          {c.status === "ACTIVE" ? <ActionButton endpoint={`${base}/hr/review-cycles/${c.id}`} method="PATCH" body={{ status: "CLOSED" }} label={t("hr.perf.closeCycle")} confirm={t("hr.perf.closeConfirm")} /> : null}
          <Link href={`/${locale}/hr/performance`} className="text-sm text-muted-foreground hover:underline">
            {t("hr.perf.title")}
          </Link>
        </>
      }
    >
      <Card>
        <CardHeader title={t("hr.perf.reviews")} description={t("hr.perf.completedOf", { done, total: c.reviews.length })} />
        {c.reviews.length ? (
          <Table>
            <THead>
              <Tr>
                <Th>{t("hr.employee")}</Th>
                <Th>{t("hr.perf.reviewerLabel")}</Th>
                <Th>{t("common.status")}</Th>
                <Th className="text-end">{t("hr.perf.self")}</Th>
                <Th className="text-end">{t("hr.manager")}</Th>
              </Tr>
            </THead>
            <TBody>
              {c.reviews.map((r) => (
                <Tr key={r.id}>
                  <Td>
                    <Link href={`/${locale}/hr/employees/${r.employee.id}?tab=performance`} className="font-medium hover:underline">
                      {personName(r.employee)}
                    </Link>
                    <div className="text-xs text-muted-foreground">{r.employee.title}</div>
                  </Td>
                  <Td>{r.reviewer ? personName(r.reviewer) : <Badge tone="warning">{t("hr.perf.noReviewer")}</Badge>}</Td>
                  <Td>
                    <Badge tone={r.status === "COMPLETED" ? "success" : "warning"}>{t(`hr.reviewStatus.${r.status}`)}</Badge>
                  </Td>
                  <Td className="text-end">{r.selfRating ?? "—"}</Td>
                  <Td className="text-end">{r.managerRating ?? "—"}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        ) : (
          <p className="p-4 text-sm text-muted-foreground">{c.status === "DRAFT" ? t("hr.perf.draftHint") : t("hr.perf.noReviews")}</p>
        )}
      </Card>
    </HrFrame>
  );
}
