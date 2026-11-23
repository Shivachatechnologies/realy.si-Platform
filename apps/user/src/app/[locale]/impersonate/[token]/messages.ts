/**
 * Strings of the impersonation banner, kept next to it (stream B owns only this folder of the user app). Move them into
 * the user-app catalogs (`impersonation.*`) when the shell owner adopts the banner.
 */
export const BANNER_MESSAGES = {
  "en-US": { title: "Impersonation session", body: "{admin} is signed in as {user}.", readOnly: "Read-only: changes are blocked", full: "Write mode: changes are allowed and audited", endsAt: "Ends at {time} ({minutes} min left)", ended: "This impersonation has ended.", end: "End impersonation", ticket: "Ticket {ref}" },
  "de-DE": { title: "Identitätswechsel-Sitzung", body: "{admin} ist als {user} angemeldet.", readOnly: "Nur Lesen: Änderungen sind gesperrt", full: "Schreibmodus: Änderungen sind erlaubt und werden protokolliert", endsAt: "Endet um {time} (noch {minutes} Min.)", ended: "Dieser Identitätswechsel ist beendet.", end: "Identitätswechsel beenden", ticket: "Ticket {ref}" },
  "ar-AE": { title: "جلسة انتحال هوية", body: "{admin} مسجّل الدخول باسم {user}.", readOnly: "قراءة فقط: التغييرات محظورة", full: "وضع الكتابة: التغييرات مسموحة ومسجّلة", endsAt: "تنتهي في {time} (متبقٍ {minutes} دقيقة)", ended: "انتهت جلسة انتحال الهوية هذه.", end: "إنهاء انتحال الهوية", ticket: "التذكرة {ref}" },
  "hi-IN": { title: "प्रतिरूपण सत्र", body: "{admin} {user} के रूप में साइन इन हैं।", readOnly: "केवल पढ़ने के लिए: बदलाव अवरुद्ध हैं", full: "लिखने का मोड: बदलाव अनुमत हैं और ऑडिट होते हैं", endsAt: "{time} पर समाप्त ({minutes} मिनट शेष)", ended: "यह प्रतिरूपण समाप्त हो गया है।", end: "प्रतिरूपण समाप्त करें", ticket: "टिकट {ref}" },
  "zh-CN": { title: "模拟登录会话", body: "{admin} 正以 {user} 的身份登录。", readOnly: "只读：已禁止更改", full: "写入模式：允许更改并记录审计", endsAt: "将于 {time} 结束（剩余 {minutes} 分钟）", ended: "此模拟登录已结束。", end: "结束模拟登录", ticket: "工单 {ref}" },
} as const;

export type BannerLocale = keyof typeof BANNER_MESSAGES;

export function bannerText(locale: string) {
  const m = BANNER_MESSAGES[(locale in BANNER_MESSAGES ? locale : "en-US") as BannerLocale];
  return (key: keyof (typeof BANNER_MESSAGES)["en-US"], vars: Record<string, string | number> = {}) => m[key].replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ""));
}
