import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadPortalsDocument, mergePortalFilters, PortalsConfigError } from "../../src/lib/portals-config.mjs";

const fixtureDirs = [];
function fixture() {
  const dir = mkdtempSync(path.join(tmpdir(), "career-ops-portals-"));
  fixtureDirs.push(dir);
  const file = path.join(dir, "portals.yml");
  const template = path.join(dir, "portals.example.yml");
  writeFileSync(template, "title_filter:\n  positive: [Template Role]\nsources:\n  acme: true\n", "utf8");
  return { file, template };
}
after(() => fixtureDirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

test("a missing user config seeds from the shipped template", () => {
  const { file, template } = fixture();
  const result = loadPortalsDocument(file, template);
  assert.equal(result.seeded, true);
  assert.deepEqual(result.doc.title_filter, { positive: ["Template Role"] });
});

test("malformed user YAML is rejected and preserved", () => {
  const { file, template } = fixture();
  const malformed = "tracked_companies: [Acme\ntitle_filter: custom";
  writeFileSync(file, malformed, "utf8");
  assert.throws(
    () => loadPortalsDocument(file, template),
    (error) => error instanceof PortalsConfigError && error.kind === "invalid-user-config",
  );
  assert.equal(readFileSync(file, "utf8"), malformed);
});

test("non-mapping user YAML is rejected", () => {
  const { file, template } = fixture();
  writeFileSync(file, "2024-01-01\n", "utf8");
  assert.throws(
    () => loadPortalsDocument(file, template),
    (error) => error instanceof PortalsConfigError && error.kind === "invalid-user-config",
  );
});

test("filter updates preserve unrelated portal configuration", () => {
  const original = {
    tracked_companies: [{ name: "Acme" }],
    title_filter: { positive: ["Old"], negative: ["Intern"] },
    location_filter: { allow: ["Old City"], remote: true },
  };
  const merged = mergePortalFilters(original, ["AI Engineer"], ["Remote"]);
  assert.deepEqual(merged.title_filter, { positive: ["AI Engineer"], negative: ["Intern"] });
  assert.deepEqual(merged.location_filter, { allow: ["Remote"], remote: true });
  assert.deepEqual(merged.tracked_companies, original.tracked_companies);
});
