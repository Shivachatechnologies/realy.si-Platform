import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { getT } from "@/i18n/server";
import type { Owner } from "./kit";

/** Date range (+ owner / pipeline / source) filter form for the Sales pages (GET, keeps the URL shareable). */
export async function RangeFilter({
  action,
  from,
  to,
  owner,
  owners,
  pipeline,
  pipelines,
  source,
  sources,
  extra,
}: {
  action: string;
  from: string;
  to: string;
  owner?: string;
  owners?: Owner[];
  pipeline?: string;
  pipelines?: { id: string; name: string }[];
  source?: string;
  sources?: string[];
  extra?: React.ReactNode;
}) {
  const t = await getT();
  return (
    <form className="flex flex-wrap items-end gap-2" action={action}>
      <label className="grid gap-1 text-xs text-muted-foreground">
        {t("sales.from")}
        <Input type="date" name="from" defaultValue={from} className="w-40" />
      </label>
      <label className="grid gap-1 text-xs text-muted-foreground">
        {t("sales.to")}
        <Input type="date" name="to" defaultValue={to} className="w-40" />
      </label>
      {owners ? (
        <Select name="owner" defaultValue={owner ?? ""} aria-label={t("crm.owner")} className="w-44">
          <option value="">{t("crm.allOwners")}</option>
          {owners.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </Select>
      ) : null}
      {pipelines && pipelines.length > 1 ? (
        <Select name="pipeline" defaultValue={pipeline ?? ""} aria-label={t("crm.fields.pipeline")} className="w-44">
          <option value="">{t("crm.allPipelines")}</option>
          {pipelines.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
      ) : null}
      {sources ? (
        <Select name="source" defaultValue={source ?? ""} aria-label={t("crm.source")} className="w-40">
          <option value="">{t("crm.allSources")}</option>
          {sources.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
      ) : null}
      {extra}
      <Button type="submit" variant="secondary">
        {t("crm.applyFilters")}
      </Button>
    </form>
  );
}
