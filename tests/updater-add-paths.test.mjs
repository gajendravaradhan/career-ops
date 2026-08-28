import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { addPaths, expandToShippedFiles, gitIn, isTracked } from '../update-system.mjs';

function repo() {
  const root = mkdtempSync(join(tmpdir(), 'co-add-paths-'));
  const git = (...args) => gitIn(root, ...args);
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  git('config', 'commit.gpgsign', 'false');
  return { root, git, ctx: { root, git } };
}

test('forced staging handles an ignored tracked file without sweeping ignored siblings', () => {
  const f = repo();
  try {
    mkdirSync(join(f.root, 'docs'));
    writeFileSync(join(f.root, 'docs', 'README.md'), 'v1');
    writeFileSync(join(f.root, '.gitignore'), 'docs/\n');
    f.git('add', '-f', 'docs/README.md', '.gitignore');
    f.git('commit', '-qm', 'base');
    writeFileSync(join(f.root, 'docs', 'README.md'), 'v2');
    writeFileSync(join(f.root, 'docs', 'secret.env'), 'SECRET=yes');

    const files = expandToShippedFiles(['docs/'], 'HEAD', f.ctx);
    assert.deepEqual(files, ['docs/README.md']);
    addPaths(files, f.ctx);
    const staged = f.git('diff', '--cached', '--name-only');
    assert.equal(staged, 'docs/README.md');
    assert.throws(() => addPaths(['docs/'], f.ctx), /directory pathspec/);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('tracked and never-tracked dismiss markers are distinguished before deletion', () => {
  const f = repo();
  try {
    writeFileSync(join(f.root, '.gitignore'), '.update-dismissed\n');
    writeFileSync(join(f.root, 'seed'), 'x');
    f.git('add', '.gitignore', 'seed');
    f.git('commit', '-qm', 'base');
    writeFileSync(join(f.root, '.update-dismissed'), 'dismissed');
    assert.equal(isTracked('.update-dismissed', f.ctx), false);
    unlinkSync(join(f.root, '.update-dismissed'));
    assert.doesNotThrow(() => addPaths(['seed'], f.ctx));
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});
