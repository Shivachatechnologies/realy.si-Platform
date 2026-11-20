import { createTranslator } from "@/i18n/translate";
import enUS from "@/i18n/messages/en-US.json";

/** English labels for prompts and CSV headers (AI tools work in English regardless of the viewer's locale). */
export const englishT = createTranslator("en-US", enUS);
