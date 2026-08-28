import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { gitRemoteVersion, highestSemverTag } from '../update-system.mjs';

test('highestSemverTag selects only the requested monorepo component', () => {
  const refs = [
    'aaaa\trefs/tags/career-ops-v1.9.0',
    'bbbb\trefs/tags/career-ops-v1.30.0^{}',
    'cccc\trefs/tags/web-v9.0.0',
    'dddd\trefs/tags/manifesto-v8.0.0',
    'eeee\trefs/tags/career-ops-v1.29.0\r',
  ].join('\n');
  assert.equal(highestSemverTag(refs, 'career-ops-v'), '1.30.0');
  assert.equal(highestSemverTag('aaaa\trefs/tags/web-v9.0.0', 'career-ops-v'), '');
});

test('git fallback is bounded, noninteractive, and gated behind both curl failures', () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const src = readFileSync(join(root, 'update-system.mjs'), 'utf8');
  const guard = src.slice(src.indexOf('const bothNetworkFailed'), src.indexOf("if (!remote) {", src.indexOf('const bothNetworkFailed')));
  assert.match(guard, /if \(bothNetworkFailed\)[\s\S]*gitRemoteVersion\(\)/);
  assert.match(src, /GIT_TERMINAL_PROMPT: '0'/);
  assert.match(src, /CHECK_GIT_PROBE_TIMEOUT_MS = 5000/);
  assert.match(src, /payload\.detail = `curl VERSION:/);
});

test('a failing git transport returns a diagnosis instead of throwing', () => {
  const result = gitRemoteVersion('https://career-ops-update.invalid/repo.git');
  assert.equal(result.ok, false);
  assert.ok(String(result.detail).trim().length > 0);
});
