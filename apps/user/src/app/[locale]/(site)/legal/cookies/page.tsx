import { LegalPage, legalMetadata } from "@/components/legal/legal-page";

/** Public legal page (built-in draft until a reviewed text is published in the CMS as `legal-cookies`). */
export const generateMetadata = () => legalMetadata("cookies");

export default function Page() {
  return <LegalPage doc="cookies" />;
}
