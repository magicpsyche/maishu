/** Console-owned copy only. Protocol values, logs and user content are not translated. */
import translations from "./ui-translations.json";
const dictionary = translations as Record<string, string>;
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const patterns = Object.entries(dictionary).filter(([source]) => /\{[\w]+\}/.test(source)).map(([source, target]) => {
  const names: string[] = [];
  const expression = source.split(/(\{[\w]+\})/).map((part) => {
    if (/^\{[\w]+\}$/.test(part)) { names.push(part.slice(1, -1)); return "([\\s\\S]*?)"; }
    return escape(part);
  }).join("");
  return { regex: new RegExp(`^${expression}$`), names, target };
});
export function uiText(message: string): string {
  let locale = "zh-CN";
  try { locale = localStorage.getItem("maishu-locale") ?? localStorage.getItem("oma-locale") ?? "zh-CN"; }
  catch { /* Restricted storage keeps the Chinese default. */ }
  if (locale === "en") return message;
  if (dictionary[message]) return dictionary[message];
  for (const pattern of patterns) {
    const match = pattern.regex.exec(message);
    if (match) return pattern.target.replace(/\{([\w]+)\}/g, (token, name: string) => {
      const index = pattern.names.indexOf(name);
      return index < 0 ? token : match[index + 1];
    });
  }
  return message;
}
