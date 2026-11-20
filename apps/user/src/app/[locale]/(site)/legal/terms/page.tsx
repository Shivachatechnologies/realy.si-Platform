import { LegalPage, legalMetadata } from "@/components/legal/legal-page";

/** Public legal page (built-in draft until a reviewed text is published in the CMS as `legal-terms`). */
export const generateMetadata = () => legalMetadata("terms");

export default function Page() {
  return <LegalPage doc="terms" />;
}
