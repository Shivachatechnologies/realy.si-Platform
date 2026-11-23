import { Skeleton, SkeletonTable } from "@/components/ui/skeleton";
import { getT } from "@/i18n/server";

/** Console-wide loading state (every page under the shell): header, a KPI row and a table-shaped placeholder. */
export default async function ConsoleLoading() {
  const t = await getT();
  return (
    <div className="grid gap-4" aria-busy="true" aria-live="polite">
      <span className="sr-only">{t("common.loading")}</span>
      <div className="flex items-center gap-3">
        <Skeleton className="size-10 rounded-lg" />
        <div className="grid flex-1 gap-2">
          <Skeleton className="h-5 w-56" />
          <Skeleton className="h-3 w-80 max-w-full" />
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-24 rounded-lg" />
        ))}
      </div>
      <SkeletonTable rows={8} cols={5} />
    </div>
  );
}
