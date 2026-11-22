import { profileByKey } from "@/server/modules/agents/profiles";

/**
 * Deterministic intent map for AI Command: words (in all five shipped languages) → the department's AI employee
 * profile. A command that matches several departments fans out to each; one that matches none goes to the AI CEO,
 * who decides and delegates (the AI fallback).
 */
export const COMMAND_INTENTS = [
  { key: "prospecting", profile: "sdr", words: ["customer", "prospect", "lead", "outreach", "cold email", "kunde", "interessent", "客户", "潜在", "线索", "ग्राहक", "लीड", "عملاء", "عميل", "زبائن"] },
  { key: "sales", profile: "account_executive", words: ["deal", "proposal", "pipeline", "close the", "quote", "sales", "selling", "verkauf", "销售", "बिक्री", "مبيعات", "angebot", "abschluss", "交易", "报价", "सौदा", "प्रस्ताव", "صفقة", "عرض سعر"] },
  { key: "marketing", profile: "cmo", words: ["marketing", "campaign", "brand", "advertis", "social media", "launch", "kampagne", "werbung", "营销", "推广", "活动", "विपणन", "अभियान", "تسويق", "حملة"] },
  { key: "content", profile: "content_writer", words: ["blog", "article", "newsletter", "copywrit", "linkedin post", "artikel", "文章", "博客", "लेख", "ब्लॉग", "مقال", "مدونة"] },
  { key: "seo", profile: "seo_specialist", words: ["seo", "keyword", "ranking", "suchmaschine", "搜索引擎", "कीवर्ड", "الكلمات المفتاحية"] },
  { key: "product", profile: "product_manager", words: ["product", "feature", "roadmap", "prd", "specification", "produkt", "funktion", "产品", "功能", "उत्पाद", "फ़ीचर", "منتج", "ميزة"] },
  { key: "finance", profile: "ai_cfo", words: ["financ", "invoice", "cash", "budget", "revenue", "expense", "profit", "p&l", "forecast", "finanz", "rechnung", "umsatz", "财务", "发票", "预算", "收入", "वित्त", "चालान", "बजट", "مالي", "فاتورة", "ميزانية", "إيرادات"] },
  { key: "recruiting", profile: "recruiter", words: ["hire", "hiring", "recruit", "job post", "candidate", "vacancy", "einstell", "stelle", "bewerber", "招聘", "候选人", "भर्ती", "उम्मीदवार", "توظيف", "مرشح", "وظيفة"] },
  { key: "people", profile: "people_analyst", words: ["employee", "headcount", "payroll", "leave", "onboard", "mitarbeiter", "员工", "कर्मचारी", "موظف"] },
  { key: "support", profile: "support_lead", words: ["support", "ticket", "complaint", "helpdesk", "help desk", "kundendienst", "客服", "工单", "सहायता", "टिकट", "دعم", "تذكرة"] },
  { key: "projects", profile: "ai_project_manager", words: ["project", "sprint", "milestone", "deadline", "task list", "projekt", "项目", "里程碑", "परियोजना", "مشروع"] },
  { key: "automation", profile: "automation_architect", words: ["automat", "workflow", "zap", "自动", "工作流", "स्वचालित", "वर्कफ़्लो", "أتمتة", "سير العمل"] },
  { key: "analytics", profile: "bi_analyst", words: ["kpi", "metric", "analytics", "dashboard", "trend", "why ", "declin", "dropping", "falling", "warum", "rückgang", "为什么", "下降", "क्यों", "गिरावट", "لماذا", "انخفاض", "kennzahl", "指标", "仪表板", "मीट्रिक", "مؤشر", "لوحة"] },
  { key: "operations", profile: "operations_assistant", words: ["process", "checklist", "sop", "vendor", "supplier", "prozess", "lieferant", "流程", "供应商", "प्रक्रिया", "आपूर्तिकर्ता", "عملية", "مورد"] },
  { key: "knowledge", profile: "brain_answerer", words: ["document", "policy", "knowledge", "dokument", "richtlinie", "文档", "政策", "दस्तावेज़", "नीति", "وثيقة", "سياسة"] },
] as const;
export const FALLBACK = { key: "fallback", profile: "ai_ceo" } as const;
const MAX_FANOUT = 3;

export interface RoutedIntent {
  key: string;
  profile: string;
  score: number;
}

/** Route a command to up to three department profiles (most matched words first); none → the AI CEO fallback. */
export function routeCommand(text: string): RoutedIntent[] {
  const lower = ` ${text.toLowerCase()} `;
  const hits = COMMAND_INTENTS.map((i) => ({ key: i.key, profile: i.profile, score: i.words.filter((w) => lower.includes(w)).length }))
    .filter((i) => i.score > 0 && profileByKey(i.profile))
    .sort((a, b) => b.score - a.score);
  // One department per profile family: "content" and "seo" fold into "marketing" when both match.
  const picked: RoutedIntent[] = [];
  for (const h of hits) {
    if ((h.key === "content" || h.key === "seo") && picked.some((p) => p.key === "marketing")) continue;
    if (h.key === "marketing" && picked.some((p) => p.key === "content" || p.key === "seo")) {
      const i = picked.findIndex((p) => p.key === "content" || p.key === "seo");
      picked[i] = h;
      continue;
    }
    if (!picked.some((p) => p.profile === h.profile)) picked.push(h);
  }
  if (picked.length) return picked.slice(0, MAX_FANOUT);
  const fb = profileByKey(FALLBACK.profile) ? FALLBACK.profile : "research_analyst";
  return [{ key: FALLBACK.key, profile: fb, score: 0 }];
}

