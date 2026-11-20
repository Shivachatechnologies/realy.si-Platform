import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Check, Play } from "lucide-react";
import { ActionButton } from "@/components/workforce/action-button";
import { AiAvatar } from "@/components/workforce/avatar";
import { ProfileForm, type ProfileSection } from "@/components/workforce/profile-form";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { getLocale, getT } from "@/i18n/server";
import { db } from "@/server/core/db";
import { isAppError } from "@/server/core/errors";
import { can } from "@/server/modules/rbac/service";
import { companyChain } from "@/server/modules/rbac/scope";
import { profileOptions, profileValues } from "@/server/modules/workforce/profile-options";
import { getEmployee, setupSteps } from "@/server/modules/workforce/service";
import { requireOrgContext } from "@/server/workspace";
import { cn } from "@/lib/utils";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("workforce.setup.title") };
}

const FORM_STEPS: Record<string, ProfileSection> = { configure: "configure", role: "role", goals: "goals", permissions: "permissions" };

/** Lifecycle of an AI employee: create → configure → assign role → goals → permissions → activate. */
export default async function EmployeeSetupPage({ params, searchParams }: PageProps<"/[locale]/workforce/[employeeId]/setup">) {
  const { employeeId } = await params;
  const locale = await getLocale();
  const t = await getT(locale);
  const { viewer, org, company } = await requireOrgContext(locale);
  if (!company) notFound();
  const e = await getEmployee(viewer.ctx, org.id, company.id, employeeId).catch((err) => {
    if (isAppError(err) && (err.code === "not_found" || err.code === "forbidden")) notFound();
    throw err;
  });
  const chain = await companyChain(db(), org.id, company.id);
  const canManage = await can(viewer.ctx, "agents.manage", chain);
  const steps = setupSteps(e);
  const sp = await searchParams;
  const requested = typeof sp.step === "string" ? sp.step : undefined;
  const current: string = steps.find((s) => s.key === requested && s.key !== "create")?.key ?? steps.find((s) => !s.done)?.key ?? "activate";
  const idx = steps.findIndex((s) => s.key === current);
  const next = steps[idx + 1]?.key;
  const apiBase = `/api/v1/organizations/${org.id}/companies/${company.id}`;
  const options = canManage ? await profileOptions(viewer.ctx, org.id, company.id, e, t) : null;

  return (
    <div className="mx-auto grid max-w-[1000px] gap-4">
      <Link href={`/${locale}/workforce/${e.id}`} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft aria-hidden className="size-4 rtl:rotate-180" />
        {t("workforce.setup.back", { name: e.name })}
      </Link>
      <div className="flex items-center gap-3">
        <AiAvatar id={e.id} initials={e.initials} paused={e.status === "PAUSED"} size="lg" />
        <div className="grid gap-0.5">
          <h1 className="text-lg font-semibold tracking-tight">{t("workforce.setup.heading", { name: e.name })}</h1>
          <p className="text-sm text-muted-foreground">{t(`profiles.${e.profileKey}.name`)}</p>
        </div>
      </div>
      <nav aria-label={t("workforce.setup.title")}>
        <ol className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {steps.map((s, i) => (
            <li key={s.key}>
              {s.key === "create" ? (
                <span className="flex items-center gap-2 rounded-md border bg-surface-2 p-2 text-sm text-muted-foreground">
                  <Check aria-hidden className="size-4 text-success" />
                  {i + 1}. {t(`workforce.setup.steps.${s.key}`)}
                </span>
              ) : (
                <Link
                  href={`/${locale}/workforce/${e.id}/setup?step=${s.key}`}
                  aria-current={s.key === current ? "step" : undefined}
                  className={cn("flex items-center gap-2 rounded-md border p-2 text-sm hover:bg-muted/50", s.key === current ? "border-primary font-medium" : "text-muted-foreground")}
                >
                  {s.done ? <Check aria-hidden className="size-4 text-success" /> : <span className="size-4 rounded-full border" aria-hidden />}
                  {i + 1}. {t(`workforce.setup.steps.${s.key}`)}
                </Link>
              )}
            </li>
          ))}
        </ol>
      </nav>

      {!canManage ? <Notice tone="warning">{t("errors.forbidden")}</Notice> : null}
      {canManage && options ? (
        <Card>
          <CardHeader title={t(`workforce.setup.steps.${current}`)} description={t(`workforce.setup.hints.${current}`)} />
          <CardBody className="grid gap-4">
            {FORM_STEPS[current] ? (
              <>
                <ProfileForm key={current} apiBase={apiBase} employeeId={e.id} sections={[FORM_STEPS[current]!]} initial={profileValues(e)} options={options} />
                {next ? (
                  <div>
                    <Button asChild variant="secondary" size="sm">
                      <Link href={`/${locale}/workforce/${e.id}/setup?step=${next}`}>{t("workforce.setup.next")}</Link>
                    </Button>
                  </div>
                ) : null}
              </>
            ) : e.status === "ACTIVE" ? (
              <div className="grid justify-items-start gap-2">
                <Notice tone="success">{t("workforce.setup.active", { name: e.name })}</Notice>
                <Button asChild size="sm">
                  <Link href={`/${locale}/workforce/${e.id}`}>{t("workforce.setup.open")}</Link>
                </Button>
              </div>
            ) : (
              <div className="grid justify-items-start gap-3">
                <ul className="grid gap-1 text-sm">
                  {steps
                    .filter((s) => s.key !== "activate")
                    .map((s) => (
                      <li key={s.key} className="flex items-center gap-2">
                        {s.done ? <Check aria-hidden className="size-4 text-success" /> : <span className="size-4 rounded-full border" aria-hidden />}
                        {t(`workforce.setup.steps.${s.key}`)}
                        {!s.done ? <span className="text-xs text-muted-foreground">· {t("workforce.setup.optional")}</span> : null}
                      </li>
                    ))}
                </ul>
                <ActionButton path={`${apiBase}/workforce/employees/${e.id}/status`} body={{ status: "ACTIVE" }} variant="default" redirectTo={`/workforce/${e.id}`}>
                  <Play aria-hidden />
                  {t("workforce.setup.activate")}
                </ActionButton>
              </div>
            )}
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
