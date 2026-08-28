import { asciiFold } from "./ascii-fold.mjs";

/**
 * Build likely ASCII domains from a company name. Curated domains remain first.
 * Accented Latin letters are folded instead of deleted (Telefónica -> telefonica).
 * @param {string} company
 * @param {(name: string) => string | null} [curatedDomain]
 * @returns {string[]}
 */
export function companyDomains(company, curatedDomain = () => null) {
  const value = String(company ?? "");
  const paren = value.match(/\(([A-Za-z0-9]{2,12})\)/)?.[1];
  const base = value.replace(/\([^()]*\)/g, "").trim();
  const fold = (input) => asciiFold(input, { punctuation: "delete" }).replace(/ /g, "");
  const compact = fold(base.replace(/&/g, "and"));
  const firstWord = fold(base.split(/\s+/)[0] ?? "");
  const stems = [...new Set([compact, paren?.toLowerCase(), firstWord]
    .filter((stem) => !!stem && stem.length >= 2 && stem.length <= 30))];

  const out = [];
  const curated = curatedDomain(base);
  if (curated) out.push(curated);
  for (const tld of [".com", ".ai", ".io", ".co"]) {
    for (const stem of stems) out.push(stem + tld);
  }
  return [...new Set(out)].slice(0, 5);
}
