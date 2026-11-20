import { LegalPage, legalMetadata } from "@/components/legal/legal-page";

/** Public legal page (built-in draft until a reviewed text is published in the CMS as `legal-privacy`). */
export const generateMetadata = () => legalMetadata("privacy");

export default function Page() {
  return <LegalPage doc="privacy" />;
}
