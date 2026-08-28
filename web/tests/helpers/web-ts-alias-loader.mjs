import { register } from "node:module";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

if (!globalThis.__careerOpsWebAliasRegistered) {
  globalThis.__careerOpsWebAliasRegistered = true;
  register(import.meta.url, import.meta.url);
}

const WEB_SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "src");
const HAS_EXT = /\.(m?[jt]sx?|json)$/i;

export async function resolve(specifier, context, nextResolve) {
  if (!specifier.startsWith("@/")) return nextResolve(specifier, context);
  const base = path.join(WEB_SRC, specifier.slice(2));
  const candidates = HAS_EXT.test(specifier) ? [base] : [`${base}.ts`, `${base}.tsx`, `${base}.mjs`];
  const hit = candidates.find((candidate) => existsSync(candidate)) ?? candidates[0];
  return nextResolve(pathToFileURL(hit).href, context);
}
