import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { prepareCliLaunch } from "../../src/lib/cli-launch.mjs";

test("POSIX and native Windows commands keep their argv boundaries", () => {
  const args = ["-p", 'review this & echo "not a command"'];
  assert.deepEqual(prepareCliLaunch("/usr/local/bin/gemini", args, "linux"), {
    command: "/usr/local/bin/gemini", args,
  });
  assert.deepEqual(prepareCliLaunch("C:\\tools\\codex.exe", args, "win32"), {
    command: "C:\\tools\\codex.exe", args,
  });
});

test("an npm Windows shim resolves to its real Node entrypoint", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "career-ops-cli-"));
  try {
    const bare = path.join(dir, "gemini");
    const entry = path.join(dir, "node_modules", "example", "cli.js");
    fs.mkdirSync(path.dirname(entry), { recursive: true });
    fs.writeFileSync(entry, "// fixture\n", "utf8");
    fs.writeFileSync(`${bare}.ps1`, '& "node$exe" "$basedir/node_modules/example/cli.js" $args\n', "utf8");
    const args = ["-p", 'review & keep "quotes"'];
    assert.deepEqual(prepareCliLaunch(`${bare}.cmd`, args, "win32"), {
      command: process.execPath,
      args: [entry, ...args],
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("an unresolved Windows shell wrapper fails closed", () => {
  const missing = path.join(os.tmpdir(), `career-ops-missing-${Date.now()}`, "gemini.cmd");
  assert.throws(() => prepareCliLaunch(missing, ["-p", "hello"], "win32"), /Cannot safely launch/);
});
