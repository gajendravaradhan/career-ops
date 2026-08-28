import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { companySlug } from "../../src/lib/company-slug.mjs";
import { matchesTailoredPdf } from "../../src/lib/apply/pdf-match.mjs";
import { pdfPathForReport, reportNumberFromCell } from "../../src/lib/apply/cv-selection.mjs";
import "../helpers/web-ts-alias-loader.mjs";

const { resolveTailoredCv } = await import("../../src/lib/apply/cv.ts");
const { resolveTailoredCover } = await import("../../src/lib/apply/cover.ts");

test("company keys and flat PDF matching fail closed", () => {
  assert.deepEqual(companySlug("Acme Corp"), { slug: "acme-corp", first: "acme" });
  for (const value of ["", "?", "!!!", "株式会社メルカリ"]) assert.equal(companySlug(value), null);

  assert.equal(matchesTailoredPdf("cv-jane-acme-2026-01-01.pdf", "cv", "Acme"), true);
  assert.equal(matchesTailoredPdf("cover-acme-2026-01-01.pdf", "cv", "Acme"), false);
  assert.equal(matchesTailoredPdf("cv-jane-metabase-2026-01-01.pdf", "cv", "Meta"), false);
  assert.equal(matchesTailoredPdf("cv-jane-acme-2026-01-01.pdf", "cv", "?"), false);
});

test("report and PDF-index parsing require canonical numeric identities", () => {
  assert.equal(reportNumberFromCell("[010](../reports/010-acme.md)"), 10);
  assert.equal(reportNumberFromCell("../reports/123-acme.md"), 123);
  assert.equal(reportNumberFromCell("notes from 2026-01-01"), null);
  const index = "010\toutput/cv-old.pdf\n10junk\toutput/cv-wrong.pdf\n011\toutput/cv-new.pdf\n";
  assert.equal(pdfPathForReport(index, 10), "output/cv-old.pdf");
  assert.equal(pdfPathForReport(index, 11), "output/cv-new.pdf");
});

test("application lookup uses its exact indexed CV; flat fallback separates CV and cover", () => {
  const root = mkdtempSync(path.join(tmpdir(), "co-web-pdf-"));
  const prior = process.env.CAREER_OPS_ROOT;
  try {
    mkdirSync(path.join(root, "data"), { recursive: true });
    mkdirSync(path.join(root, "output"), { recursive: true });
    writeFileSync(path.join(root, "data", "applications.md"), [
      "| # | Date | Company | Role | Score | Status | PDF | Report | Notes |",
      "|---|------|---------|------|-------|--------|-----|--------|-------|",
      "| 1 | 2026-08-01 | Acme | Old Role | 4.0/5 | Applied | ✅ | [010](../reports/010-acme.md) | |",
      "| 2 | 2026-08-02 | Acme | New Role | 4.1/5 | Applied | ✅ | [011](../reports/011-acme.md) | |",
    ].join("\n"));
    writeFileSync(path.join(root, "data", "pdf-index.tsv"), [
      "010\toutput/cv-acme-old.pdf\t\thtml\t2026-08-01",
      "011\toutput/cv-acme-new.pdf\t\thtml\t2026-08-02",
    ].join("\n"));
    for (const filename of ["cv-acme-old.pdf", "cv-acme-new.pdf", "cover-acme-new.pdf"]) {
      writeFileSync(path.join(root, "output", filename), "%PDF fixture");
    }
    process.env.CAREER_OPS_ROOT = root;

    assert.equal(path.basename(resolveTailoredCv("Acme", "1")), "cv-acme-old.pdf");
    assert.equal(path.basename(resolveTailoredCv("Acme", "2")), "cv-acme-new.pdf");
    assert.equal(path.basename(resolveTailoredCv("Acme")), "cv-acme-new.pdf");
    assert.equal(path.basename(resolveTailoredCover("Acme")), "cover-acme-new.pdf");
    assert.equal(resolveTailoredCv("?"), null);

    writeFileSync(path.join(root, "data", "pdf-index.tsv"), "010\t../outside.pdf\n");
    writeFileSync(path.join(root, "outside.pdf"), "%PDF outside");
    assert.equal(resolveTailoredCv("Acme", "1"), null, "indexed paths outside output/ must be rejected");
  } finally {
    if (prior === undefined) delete process.env.CAREER_OPS_ROOT;
    else process.env.CAREER_OPS_ROOT = prior;
    rmSync(root, { recursive: true, force: true });
  }
});
