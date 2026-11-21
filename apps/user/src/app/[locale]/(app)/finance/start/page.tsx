import type { Metadata } from "next";
import { FinanceFlows, FLOWS, type Flow, type FlowOptions, type Snapshot } from "@/components/finance/guided-flows";
import { financePage } from "@/components/finance/page-context";
import { getT } from "@/i18n/server";
import { aiConfigured } from "@/server/modules/agents/runtime";
import { financeSnapshot, getFlowProgress, guidedOptions } from "@/server/modules/finance/guided";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("finance.os.startTitle") };
}

const serialize = <T,>(v: T): T => JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x)));

/** Beginner finance home: six plain-language actions, each a short guided flow through the existing finance services. */
export default async function FinanceStartPage({ searchParams }: PageProps<"/[locale]/finance/start">) {
  const p = await financePage("start");
  if (p.blocked) return p.blocked;
  const { locale, viewer, org, company, base } = p;
  const q = await searchParams;
  const requested = typeof q.flow === "string" ? q.flow : undefined;
  const initialFlow = (FLOWS as readonly string[]).includes(requested ?? "") ? (requested as Flow) : null;
  const [snapshot, options, ...progress] = await Promise.all([
    financeSnapshot(viewer.ctx, org.id, company.id),
    guidedOptions(viewer.ctx, org.id, company.id),
    ...FLOWS.map((f) => getFlowProgress(viewer.ctx, org.id, company.id, f)),
  ]);
  const progressMap = Object.fromEntries(FLOWS.map((f, i) => [f, { step: progress[i]!.step, data: progress[i]!.data as Record<string, string | number | boolean | null>, completed: !!progress[i]!.completedAt }])) as Record<Flow, { step: number; data: Record<string, string | number | boolean | null>; completed: boolean }>;
  return p.frame(
    <FinanceFlows
      base={base}
      companyBase={`/api/v1/organizations/${org.id}/companies/${company.id}`}
      locale={locale}
      options={serialize(options) as FlowOptions}
      snapshot={serialize(snapshot) as unknown as Snapshot}
      progress={progressMap}
      initialFlow={initialFlow}
      canManage={p.canManage}
      aiReady={aiConfigured() && p.canRunAgents}
    />,
  );
}
