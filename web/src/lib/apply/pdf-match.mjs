import fs from "node:fs";
import path from "node:path";
import { companySlug } from "../company-slug.mjs";

function escaped(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Strict prefix + company-token match for legacy flat output filenames. */
export function matchesTailoredPdf(filename, prefix, company) {
  const key = companySlug(company);
  if (!key) return false;
  const lower = String(filename ?? "").toLowerCase();
  if (!lower.startsWith(`${prefix}-`) || !lower.endsWith(".pdf")) return false;
  const re = new RegExp(`(^|[^a-z0-9])${escaped(key.slug)}([^a-z0-9]|$)`, "i");
  return re.test(lower);
}

/** Newest readable candidate; files removed between readdir/stat are skipped. */
export function newestExistingPdf(dir, files) {
  const candidates = [];
  for (const filename of files) {
    try {
      const file = path.join(dir, filename);
      const stat = fs.statSync(file);
      if (stat.isFile()) candidates.push({ file, mtime: stat.mtimeMs });
    } catch {
      // Concurrent output pruning: a vanished candidate is not a fatal lookup.
    }
  }
  candidates.sort((a, b) => b.mtime - a.mtime);
  return candidates[0]?.file ?? null;
}

export function resolveFlatTailoredPdf(root, prefix, company) {
  const dir = path.join(root, "output");
  let files;
  try {
    files = fs.readdirSync(dir).filter((file) => matchesTailoredPdf(file, prefix, company));
  } catch {
    return null;
  }
  return newestExistingPdf(dir, files);
}
