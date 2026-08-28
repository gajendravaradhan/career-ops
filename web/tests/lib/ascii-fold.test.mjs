import { test } from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL, fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { asciiFold as webFold } from "../../src/lib/core/ascii-fold.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const { asciiFold: coreFold } = await import(pathToFileURL(join(ROOT, "lib", "ascii-fold.mjs")).href);
const CASES = [
  "Telefónica", "Škoda", "Ørsted", "Société Générale", "Nestlé", "Işık",
  "Æther", "Œuvre", "Straße", "Đorđević", "Łódź", "Þór", "Ðan", "Ħamrun",
  "Ŋaro", "Ŧorp", "Kalaallit ĸ", "ſharp", "日本電産", "Яндекс", "Ελλάδα",
  "Acme Inc", "AT&T", "Smith&Jones", "O'Reilly Media", "",
];

test("web ASCII folding stays aligned with core", () => {
  for (const value of CASES) {
    for (const punctuation of ["space", "delete"]) {
      assert.equal(webFold(value, { punctuation }), coreFold(value, { punctuation }), `${value} (${punctuation})`);
    }
  }
});

test("accented letters are folded rather than deleted", () => {
  assert.equal(webFold("Telefónica", { punctuation: "delete" }), "telefonica");
  assert.equal(webFold("Ørsted", { punctuation: "delete" }), "orsted");
  assert.equal(webFold("Straße", { punctuation: "delete" }), "strasse");
  assert.equal(webFold("Ŋaro", { punctuation: "delete" }), "ngaro");
});
