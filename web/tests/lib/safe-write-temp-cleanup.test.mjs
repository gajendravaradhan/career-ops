import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const source = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src", "lib", "core", "safe-write.ts"),
  "utf8",
);

function atomicWriteBody() {
  const start = source.indexOf("export function atomicWrite");
  assert.notEqual(start, -1);
  const open = source.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}" && --depth === 0) return source.slice(open, i + 1);
  }
  throw new Error("unbalanced atomicWrite body");
}

test("atomicWrite cleans its user-data temp file and rethrows the write error", () => {
  const body = atomicWriteBody();
  const renameAt = body.search(/renameSync\s*\(/);
  const catchAt = body.indexOf("catch", renameAt);
  assert.ok(body.indexOf("try") < renameAt);
  assert.ok(catchAt > renameAt);
  assert.match(body.slice(catchAt), /rmSync\s*\([^)]*force\s*:\s*true/s);
  assert.match(body.slice(catchAt), /throw\s+err\b/);
  assert.match(body, /\.tmp/);
});
