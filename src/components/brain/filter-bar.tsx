import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select } from "@/components/ui/input";
import type { Translate } from "@/i18n/translate";
import { SOURCE_TYPES } from "@/server/modules/brain/service";

/** GET filter form for Company Brain lists (server component; no client state). */
export function FilterBar({
  action,
  t,
  values,
  departments,
  tags,
  show,
  qLabel,
}: {
  action: string;
  t: Translate;
  values: Record<string, string | undefined>;
  departments: { id: string; name: string }[];
  tags?: { tag: string; count: number }[];
  show: { source?: boolean; sort?: boolean; pinned?: boolean };
  qLabel: string;
}) {
  return (
    <form role="search" action={action} className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_repeat(4,minmax(0,1fr))_auto] lg:items-end">
      <Field label={qLabel} htmlFor="f-q">
        <Input id="f-q" name="q" type="search" defaultValue={values.q ?? ""} maxLength={200} />
      </Field>
      <Field label={t("brain.department")} htmlFor="f-department">
        <Select id="f-department" name="departmentId" defaultValue={values.departmentId ?? ""}>
          <option value="">{t("brain.filters.allDepartments")}</option>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </Select>
      </Field>
      {tags ? (
        <Field label={t("brain.tags")} htmlFor="f-tag">
          <Select id="f-tag" name="tag" defaultValue={values.tag ?? ""}>
            <option value="">{t("brain.filters.allTags")}</option>
            {tags.map((x) => (
              <option key={x.tag} value={x.tag}>
                #{x.tag} ({x.count})
              </option>
            ))}
          </Select>
        </Field>
      ) : null}
      {show.source ? (
        <Field label={t("brain.columns.source")} htmlFor="f-source">
          <Select id="f-source" name="source" defaultValue={values.source ?? ""}>
            <option value="">{t("brain.filters.allSources")}</option>
            <option value="upload">{t("brain.sources.upload")}</option>
            {SOURCE_TYPES.map((s) => (
              <option key={s} value={s}>
                {t(`brain.sources.${s}`)}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}
      {show.pinned ? (
        <Field label={t("brain.memory.pinned")} htmlFor="f-pinned">
          <Select id="f-pinned" name="pinned" defaultValue={values.pinned ?? ""}>
            <option value="">{t("brain.filters.all")}</option>
            <option value="1">{t("brain.memory.pinnedOnly")}</option>
            <option value="0">{t("brain.memory.unpinnedOnly")}</option>
          </Select>
        </Field>
      ) : null}
      {show.sort ? (
        <Field label={t("brain.filters.sort")} htmlFor="f-sort">
          <Select id="f-sort" name="sort" defaultValue={values.sort ?? "newest"}>
            <option value="newest">{t("brain.filters.newest")}</option>
            <option value="oldest">{t("brain.filters.oldest")}</option>
            <option value="title">{t("brain.filters.byTitle")}</option>
          </Select>
        </Field>
      ) : null}
      <Button type="submit">
        <Search aria-hidden />
        {t("brain.filters.apply")}
      </Button>
    </form>
  );
}
