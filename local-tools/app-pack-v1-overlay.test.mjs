import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

import {
  END_MARKER,
  LOCAL_PATH_ENTRY,
  REQUIRED_OVERLAY_FILES,
  START_MARKER,
  WORKFLOW_BLOCK,
  applyOverlay,
  overlayStatus,
  verifyOverlay,
} from './app-pack-v1-overlay.mjs';

const execFile = promisify(execFileCallback);
const SCRIPT = fileURLToPath(new URL('./app-pack-v1-overlay.mjs', import.meta.url));

async function write(root, relativePath, content = relativePath) {
  const target = join(root, relativePath);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, content);
  return target;
}

async function workspace(t, { custom = '', localPaths = '' } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'career-ops-app-pack-v1-'));
  t.after(async () => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'modes'), { recursive: true });
  await mkdir(join(root, 'config'), { recursive: true });
  if (custom) await write(root, 'modes/_custom.md', custom);
  if (localPaths) await write(root, 'config/local-paths.txt', localPaths);
  for (const file of REQUIRED_OVERLAY_FILES) await write(root, file, `fixture: ${file}\n`);
  return root;
}

function occurrences(value, token) {
  return value.split(token).length - 1;
}

test('apply installs the bounded workflow and preserves unrelated user rules', async (t) => {
  const root = await workspace(t, {
    custom: [
      '# Custom Instructions -- career-ops',
      '',
      '## House Rules',
      '',
      '- Keep my unrelated rule.',
      '',
      '## Custom Workflows',
      '',
      '<!-- Keep this user comment. -->',
      '',
      '## Output Preferences',
      '',
      '- Keep my output preference.',
      '',
    ].join('\n'),
    localPaths: '# Existing declaration\nmy-other-tools/\n',
  });

  const result = applyOverlay(root);
  assert.deepEqual(result.changedFiles, ['config/local-paths.txt', 'modes/_custom.md']);
  assert.equal(result.installed, true);

  const custom = await readFile(join(root, 'modes/_custom.md'), 'utf8');
  const localPaths = await readFile(join(root, 'config/local-paths.txt'), 'utf8');
  assert.match(custom, /Keep my unrelated rule/);
  assert.match(custom, /Keep this user comment/);
  assert.match(custom, /Keep my output preference/);
  assert.equal(occurrences(custom, START_MARKER), 1);
  assert.equal(occurrences(custom, END_MARKER), 1);
  assert.ok(custom.includes(WORKFLOW_BLOCK));
  assert.match(localPaths, /my-other-tools\//);
  assert.equal(localPaths.split(/\r?\n/).filter((line) => line === LOCAL_PATH_ENTRY).length, 1);
});

test('apply is byte-idempotent', async (t) => {
  const root = await workspace(t, {
    custom: '# Custom Instructions -- career-ops\n\n## Custom Workflows\n',
  });
  applyOverlay(root);
  const firstCustom = await readFile(join(root, 'modes/_custom.md'));
  const firstPaths = await readFile(join(root, 'config/local-paths.txt'));

  const second = applyOverlay(root);
  assert.deepEqual(second.changedFiles, []);
  assert.deepEqual(await readFile(join(root, 'modes/_custom.md')), firstCustom);
  assert.deepEqual(await readFile(join(root, 'config/local-paths.txt')), firstPaths);
});

test('apply upgrades only an existing marker block', async (t) => {
  const root = await workspace(t, {
    custom: [
      '# Before',
      START_MARKER,
      'obsolete content',
      END_MARKER,
      '# After',
      '',
    ].join('\n'),
    localPaths: `${LOCAL_PATH_ENTRY}\n`,
  });

  applyOverlay(root);
  const custom = await readFile(join(root, 'modes/_custom.md'), 'utf8');
  assert.match(custom, /^# Before/m);
  assert.match(custom, /^# After/m);
  assert.doesNotMatch(custom, /obsolete content/);
  assert.ok(custom.includes(WORKFLOW_BLOCK));
});

test('apply fails closed on malformed markers before changing either user file', async (t) => {
  const initialPaths = '# untouched\n';
  const initialCustom = `# Custom\n${START_MARKER}\nmissing end\n`;
  const root = await workspace(t, { custom: initialCustom, localPaths: initialPaths });

  assert.throws(() => applyOverlay(root), /marker block/);
  assert.equal(await readFile(join(root, 'config/local-paths.txt'), 'utf8'), initialPaths);
  assert.equal(await readFile(join(root, 'modes/_custom.md'), 'utf8'), initialCustom);
});

test('apply de-duplicates only the local-tools declaration', async (t) => {
  const root = await workspace(t, {
    custom: `## Custom Workflows\n\n${WORKFLOW_BLOCK}\n`,
    localPaths: `# preserve me\n${LOCAL_PATH_ENTRY}\nother-local/\n${LOCAL_PATH_ENTRY}\n`,
  });

  applyOverlay(root);
  const value = await readFile(join(root, 'config/local-paths.txt'), 'utf8');
  assert.match(value, /# preserve me/);
  assert.match(value, /other-local\//);
  assert.equal(value.split(/\r?\n/).filter((line) => line === LOCAL_PATH_ENTRY).length, 1);
});

test('verification reports missing tagged files without mutating configuration', async (t) => {
  const root = await workspace(t, {
    custom: `## Custom Workflows\n\n${WORKFLOW_BLOCK}\n`,
    localPaths: `${LOCAL_PATH_ENTRY}\n`,
  });
  await rm(join(root, REQUIRED_OVERLAY_FILES[0]));

  assert.equal(overlayStatus(root).installed, false);
  assert.throws(() => verifyOverlay(root), /missing overlay file/);
});

test('apply refuses a symlinked user configuration target', async (t) => {
  const root = await workspace(t, {
    custom: '# Custom\n\n## Custom Workflows\n',
  });
  const outside = await write(root, 'outside.txt', 'outside stays untouched\n');
  const target = join(root, 'config/local-paths.txt');
  await symlink(outside, target);

  assert.throws(() => applyOverlay(root), /regular file/);
  assert.equal(await readFile(outside, 'utf8'), 'outside stays untouched\n');
});

test('CLI apply and verify return machine-readable success', async (t) => {
  const root = await workspace(t, {
    custom: '# Custom\n\n## Custom Workflows\n',
  });
  const applied = await execFile(process.execPath, [SCRIPT, 'apply', '--root', root]);
  assert.equal(JSON.parse(applied.stdout).installed, true);

  const verified = await execFile(process.execPath, [SCRIPT, 'verify', '--root', root]);
  assert.equal(JSON.parse(verified.stdout).name, 'app-pack-v1');
});
