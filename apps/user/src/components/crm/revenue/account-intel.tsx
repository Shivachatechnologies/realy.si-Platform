import { revenueChannels } from "@/server/modules/crm/channels";
import { crmContext } from "../shell";
import { IntelPanel } from "./panels";

/** Provider-backed research about an account (web sources, facts with their source). */
export async function AccountIntel({ accountId }: { accountId: string }) {
  const c = await crmContext();
  if (!c.company) return null;
  const channels = await revenueChannels(c.org.id, c.company.id);
  return <IntelPanel accountId={accountId} channels={channels} />;
}
