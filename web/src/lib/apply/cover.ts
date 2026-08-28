import { careerOpsRoot } from "@/lib/career-ops";
import { resolveFlatTailoredPdf } from "./pdf-match.mjs";

/** Locate the newest strict company-matched cover PDF, never a CV. */
export function resolveTailoredCover(company?: string): string | null {
  return resolveFlatTailoredPdf(careerOpsRoot(), "cover", company);
}
