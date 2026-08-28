import { test } from "node:test";
import assert from "node:assert/strict";
import { companyDomains } from "../../src/lib/core/company-domains.mjs";
import { COMPANY_KEY_VERSION } from "../../src/lib/core/logo-cache-key.mjs";

test("accented company names produce their real ASCII domain", () => {
  for (const [name, domain] of [
    ["Telefónica", "telefonica.com"], ["Škoda", "skoda.com"],
    ["Ørsted", "orsted.com"], ["Nestlé", "nestle.com"],
    ["Société Générale", "societegenerale.com"],
  ]) {
    assert.equal(companyDomains(name)[0], domain, name);
  }
});

test("ASCII behavior and curated priority stay stable", () => {
  assert.deepEqual(companyDomains("AT&T"), ["atandt.com", "att.com", "atandt.ai", "att.ai", "atandt.io"]);
  const notion = companyDomains("Notion", (name) => name === "Notion" ? "notion.so" : null);
  assert.equal(notion[0], "notion.so");
  assert.ok(new Set(notion).has("notion.com"));
});

test("non-Latin names fail closed and resolver cache version changed", () => {
  assert.deepEqual(companyDomains("日本電産"), []);
  assert.equal(COMPANY_KEY_VERSION, "v4");
});
