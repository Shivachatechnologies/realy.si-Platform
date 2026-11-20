import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { workflowsPage } from "@/components/automation/frame";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Select } from "@/components/ui/input";
import { getT } from "@/i18n/server";
import { formatDateTime } from "@/i18n/format";
import { AppError } from "@/server/core/errors";
import { compareVersions } from "@/server/modules/automation/service";
import { sideBySide, type DiffRow } from "@/server/modules/automation/diff";
import { cn } from "@/lib/utils";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("workflows.compare.title") };
}

const ROW_TONE: Record<DiffRow["kind"], { left: string; right: string }> = {
  same: { left: "", right: "" },
  removed: { left: "bg-danger/10", right: "bg-muted/40" },
  added: { left: "bg-muted/40", right: "bg-success/10" },
  changed: { left: "bg-danger/10", right: "bg-success/10" },
};

/** Two workflow definitions (published versions or the draft) side by side as JSON, with changed lines highlighted. */
export default async function VersionsPage({ params, searchParams }: PageProps<"/[locale]/workflows/[workflowId]/versions">) {
  const { workflowId } = await params;
  const sp = await searchParams;
  const p = await workflowsPage(null);
  if (p.page) return p.page;
  const { locale, t, viewer, org, company, tz } = p.ctx;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim() || undefined;
  const probe = await compareVersions(viewer.ctx, org.id, company.id, workflowId, "draft", "draft").catch((err) => {
    if (err instanceof AppError && err.code === "not_found") notFound();
    throw err;
  });
  const nums = probe.versions.map((v) => String(v.version));
  const valid = (k: string | undefined) => (k && (k === "draft" || nums.includes(k)) ? k : undefined);
  const right = valid(one(sp.right)) ?? (nums[0] ?? "draft");
  const left = valid(one(sp.left)) ?? (nums[1] ?? (right === "draft" ? "draft" : (nums[0] ?? "draft")));
  const data = await compareVersions(viewer.ctx, org.id, company.id, workflowId, left, right);
  const leftText = JSON.stringify(data.left?.definition ?? {}, null, 2);
  const rightText = JSON.stringify(data.right?.definition ?? {}, null, 2);
  const rows = sideBySide(leftText, rightText);
  const changes = rows.filter((r) => r.kind !== "same").length;
  const options = [{ key: "draft", label: t("workflows.compare.draft") }, ...probe.versions.map((v) => ({ key: String(v.version), label: `v${v.version} · ${formatDateTime(v.createdAt, locale, tz)}` }))];
  const picker = (name: string, value: string) => (
    <Select name={name} defaultValue={value} aria-label={t(`workflows.compare.${name}`)}>
      {options.map((o) => (
        <option key={o.key} value={o.key}>
          {o.label}
          {o.key === String(data.workflow.currentVersion) ? ` (${t("workflows.current")})` : ""}
        </option>
      ))}
    </Select>
  );
  return p.render(
    <>
      <Link href={`/${locale}/workflows/${workflowId}`} className="text-sm text-muted-foreground hover:underline">
        ← {data.workflow.name}
      </Link>
      <Card>
        <CardHeader title={t("workflows.compare.title")} description={t("workflows.compare.help")} actions={<Badge tone={changes ? "warning" : "success"}>{changes ? t("workflows.compare.changes", { count: changes }) : t("workflows.compare.identical")}</Badge>} />
        <form className="grid gap-2 border-b p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]" action={`/${locale}/workflows/${workflowId}/versions`}>
          {picker("left", left)}
          {picker("right", right)}
          <div>
            <Button type="submit" variant="secondary">
              {t("workflows.compare.show")}
            </Button>
          </div>
        </form>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] table-fixed border-collapse font-mono text-xs">
            <thead>
              <tr className="border-b text-start text-muted-foreground">
                <th className="w-10 p-1" />
                <th className="p-2 text-start font-medium">{data.left?.label === "draft" ? t("workflows.compare.draft") : data.left?.label}</th>
                <th className="w-10 p-1" />
                <th className="p-2 text-start font-medium">{data.right?.label === "draft" ? t("workflows.compare.draft") : data.right?.label}</th>
              </tr>
            </thead>
            <tbody dir="ltr">
              {rows.map((r, i) => (
                <tr key={i} className="align-top">
                  <td className="select-none p-0.5 pe-2 text-end text-muted-foreground">{r.leftNo ?? ""}</td>
                  <td className={cn("whitespace-pre-wrap break-all p-0.5", ROW_TONE[r.kind].left)}>{r.left ?? ""}</td>
                  <td className="select-none p-0.5 pe-2 text-end text-muted-foreground">{r.rightNo ?? ""}</td>
                  <td className={cn("whitespace-pre-wrap break-all p-0.5", ROW_TONE[r.kind].right)}>{r.right ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>,
  );
}
