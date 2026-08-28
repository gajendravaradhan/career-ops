import { NextRequest } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { resolveTailoredCv } from "@/lib/apply/cv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Serve the tailored CV PDF the pdf mode wrote to output/cv-…-{company}-…pdf for
// a given offer (matched by company slug, newest first). Inline so it opens in
// the browser. Local-first: reads the user's own output/ dir.
export async function GET(req: NextRequest) {
  const company = (req.nextUrl.searchParams.get("company") ?? "").trim();
  const application = (req.nextUrl.searchParams.get("application") ?? "").trim();
  if (!company && !application) return new Response("company or application required", { status: 400 });
  const file = resolveTailoredCv(company, application || undefined);
  if (!file) return new Response("no tailored CV found for this offer", { status: 404 });
  try {
    const buf = fs.readFileSync(file);
    const filename = path.basename(file);
    return new Response(new Uint8Array(buf), {
      status: 200,
      headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${filename}"`, "Cache-Control": "no-store" },
    });
  } catch {
    return new Response("could not read the PDF", { status: 500 });
  }
}
