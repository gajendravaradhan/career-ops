import fs from "node:fs";
import path from "node:path";
import { careerOpsRoot } from "@/lib/career-ops";
import { readApplications } from "@/lib/career-ops";
import { pdfPathForReport, reportNumberFromCell } from "./cv-selection.mjs";
import { resolveFlatTailoredPdf } from "./pdf-match.mjs";

/**
 * Locate the tailored CV PDF the real `pdf` mode wrote to output/ for a given
 * company (newest match wins). STRICT company match — never returns a CV tailored
 * for a different company (we'd rather attach nothing than the wrong CV). Mirrors
 * the matching in /api/cv-pdf so the "View tailored CV" link and the apply
 * file-upload always resolve to the SAME file. Returns an absolute path or null.
 */
export function resolveTailoredCv(company?: string, applicationNumber?: string): string | null {
  const root = careerOpsRoot();
  const application = String(applicationNumber ?? "").trim();
  if (application) {
    if (!/^\d+$/.test(application)) return null;
    const wanted = String(Number.parseInt(application, 10));
    const app = readApplications().find((candidate) => String(Number.parseInt(candidate.n, 10)) === wanted);
    const reportNumber = reportNumberFromCell(app?.report);
    if (!reportNumber) return null;

    let relativePdf;
    try {
      const index = fs.readFileSync(path.join(root, "data", "pdf-index.tsv"), "utf8");
      relativePdf = pdfPathForReport(index, reportNumber);
    } catch {
      return null;
    }
    if (!relativePdf) return null;

    try {
      const output = fs.realpathSync(path.join(root, "output"));
      const file = fs.realpathSync(path.resolve(root, relativePdf));
      if (file === output || !file.startsWith(output + path.sep)) return null;
      return fs.statSync(file).isFile() && file.toLowerCase().endsWith(".pdf") ? file : null;
    } catch {
      return null;
    }
  }

  const c = (company ?? "").trim();
  if (!c) return null;
  return resolveFlatTailoredPdf(root, "cv", c);
}

/**
 * Best-effort company name from an application form/page title. ATS titles look
 * like "Role - Region @ Company" (Ashby) or "Company — Role" / "Role at Company".
 * Used as a fallback when the apply flow was started by pasting a URL (no offer
 * context) rather than from a report's Apply button.
 */
export function companyFromTitle(title?: string): string {
  const t = (title ?? "").trim();
  if (!t) return "";
  const at = t.match(/@\s*([^|@]+?)\s*$/);
  if (at) return at[1].trim();
  const atWord = t.match(/\bat\s+([A-Z][\w&.\- ]+?)\s*$/);
  if (atWord) return atWord[1].trim();
  return "";
}
