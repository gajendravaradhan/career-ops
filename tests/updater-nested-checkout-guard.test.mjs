import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'fs';
import { execFileSync, spawnSync } from 'child_process';
import { join } from 'path';
import { tmpdir } from 'os';
import { gitToplevelMismatch } from '../update-system.mjs';
import { hermeticGitEnv, NODE, ROOT, rmSync } from './helpers.mjs';

function fixture() {
  const outer = mkdtempSync(join(tmpdir(), 'co-nested-updater-'));
  const env = hermeticGitEnv(join(outer, 'gitconfig'));
  const git = (...args) => execFileSync('git', args, { cwd: outer, env, encoding: 'utf8' }).trim();
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  git('config', 'commit.gpgsign', 'false');
  const nested = join(outer, 'tools', 'career-ops');
  mkdirSync(nested, { recursive: true });
  copyFileSync(join(ROOT, 'update-system.mjs'), join(nested, 'update-system.mjs'));
  copyFileSync(join(ROOT, 'VERSION'), join(nested, 'VERSION'));
  git('add', '-A');
  git('commit', '-qm', 'vendored copy');
  return { outer, nested, env, git };
}

function run(f, command) {
  return spawnSync(NODE, ['update-system.mjs', command], {
    cwd: f.nested,
    env: f.env,
    encoding: 'utf8',
    timeout: 60_000,
  });
}

test('nested updater identifies the enclosing repository', () => {
  const f = fixture();
  try {
    assert.equal(gitToplevelMismatch(f.outer), null);
    assert.equal(realpathSync(gitToplevelMismatch(f.nested)), realpathSync(f.outer));
  } finally { rmSync(f.outer, { recursive: true, force: true }); }
});

test('check reports the unsafe layout without fetching into the outer repository', () => {
  const f = fixture();
  try {
    const result = run(f, 'check');
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).status, 'not-a-git-toplevel');
    assert.equal(existsSync(join(f.outer, '.git', 'FETCH_HEAD')), false);
  } finally { rmSync(f.outer, { recursive: true, force: true }); }
});

test('the unsafe nested layout outranks a dismissal marker', () => {
  const f = fixture();
  try {
    writeFileSync(join(f.nested, '.update-dismissed'), 'dismissed\n');
    const result = run(f, 'check');
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).status, 'not-a-git-toplevel');
    assert.equal(existsSync(join(f.outer, '.git', 'FETCH_HEAD')), false);
  } finally { rmSync(f.outer, { recursive: true, force: true }); }
});

test('apply and rollback refuse before creating updater state in the outer repository', () => {
  const f = fixture();
  try {
    for (const command of ['apply', 'rollback']) {
      const result = run(f, command);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /enclosing repository/);
    }
    assert.equal(existsSync(join(f.nested, '.update-lock')), false);
    assert.equal(existsSync(join(f.outer, '.git', 'FETCH_HEAD')), false);
    assert.equal(f.git('branch', '--list', 'backup-pre-update-*'), '');
  } finally { rmSync(f.outer, { recursive: true, force: true }); }
});
