import { WhatsNext } from "@/components/guide/whats-next";

/** Command Center "What to do next": the AI Guide's top recommended actions from real counts (onboarding first). */
export async function CommandCenterNextActions(props: { organizationId: string; companyId: string; locale: string }) {
  void props;
  return <WhatsNext limit={4} />;
}
