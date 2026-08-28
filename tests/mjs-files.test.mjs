import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { collectMjsFiles, SKIP_DIRS } from '../lib/mjs-files.mjs';
import { ROOT } from './helpers.mjs';

test('collectMjsFiles recurses, filters generated trees, and sorts', () => {
  const root = mkdtempSync(join(tmpdir(), 'co-mjs-files-'));
  try {
    mkdirSync(join(root, 'nested', 'deep'), { recursive: true });
    mkdirSync(join(root, 'node_modules'), { recursive: true });
    writeFileSync(join(root, 'z.mjs'), '');
    writeFileSync(join(root, 'nested', 'deep', 'a.mjs'), '');
    writeFileSync(join(root, 'nested', 'notes.md'), '');
    writeFileSync(join(root, 'node_modules', 'ignored.mjs'), '');
    const got = collectMjsFiles(root).map((f) => f.slice(root.length + 1));
    assert.deepEqual(got, ['nested/deep/a.mjs', 'z.mjs']);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('the repository syntax scope reaches nested source trees', () => {
  const files = collectMjsFiles(ROOT).map((f) => f.slice(ROOT.length + 1).replace(/\\/g, '/'));
  for (const prefix of ['tests/', 'providers/', 'web/', 'lib/']) {
    assert.ok(files.some((f) => f.startsWith(prefix)), `${prefix} must be syntax checked`);
  }
  assert.ok(SKIP_DIRS.has('data') && SKIP_DIRS.has('output'));
});

test('a missing root throws instead of producing an empty passing scan', () => {
  assert.throws(() => collectMjsFiles(join(ROOT, 'does-not-exist-for-syntax-gate')), { code: 'ENOENT' });
});
