import { LegalPage, legalMetadata } from "@/components/legal/legal-page";

/** Public legal page (built-in draft until a reviewed text is published in the CMS as `legal-dpa`). */
export const generateMetadata = () => legalMetadata("dpa");

export default function Page() {
  return <LegalPage doc="dpa" />;
}
