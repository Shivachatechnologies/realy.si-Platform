/**
 * ICU validity guard for every message catalog (apps/user + apps/admin, all locales).
 *
 * The translator (packages/shared-utils/src/i18n/translate.ts) formats every message with intl-messageformat and only
 * passes string/number/date values, so a message that does not parse, or that contains an XML-like tag such as
 * `</body>` or `<address>`, throws at render time and takes the whole page down. Literal angle-bracket text must be
 * quoted ICU-style: `'</body>'`.
 *
 *   node scripts/i18n-icu-check.mjs     exit 1 on any invalid message (also run by `node scripts/i18n-sync.mjs --check`)
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { IntlMessageFormat } from "intl-messageformat";

const root = path.join(import.meta.dirname, "..");
const dirs = ["apps/user/src/i18n/messages", "apps/admin/src/i18n/messages"];
const TAG = 8; // TYPE.tag in @formatjs/icu-messageformat-parser

function flatten(node, prefix, out) {
  for (const [k, v] of Object.entries(node)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object") flatten(v, key, out);
    else out.push([key, v]);
  }
  return out;
}

const hasTag = (els) => els.some((e) => e.type === TAG || (e.options && Object.values(e.options).some((o) => hasTag(o.value))));

/** @returns {string[]} one line per invalid message */
export function findIcuProblems() {
  const problems = [];
  for (const dir of dirs) {
    for (const file of fs.readdirSync(path.join(root, dir)).filter((f) => f.endsWith(".json")).sort()) {
      const locale = file.replace(/\.json$/, "");
      const messages = JSON.parse(fs.readFileSync(path.join(root, dir, file), "utf8"));
      for (const [key, value] of flatten(messages, "", [])) {
        if (typeof value !== "string") continue;
        try {
          if (hasTag(new IntlMessageFormat(value, locale).getAst())) problems.push(`${dir}/${file} ${key}: contains a tag; quote literal markup as '<tag>'`);
        } catch (e) {
          problems.push(`${dir}/${file} ${key}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }
  }
  return problems;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const problems = findIcuProblems();
  for (const p of problems) console.error(`i18n-icu: ${p}`);
  if (problems.length) process.exit(1);
  console.log("i18n-icu: all messages are valid ICU.");
}
