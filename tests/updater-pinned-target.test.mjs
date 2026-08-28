import assert from 'node:assert/strict';
import test from 'node:test';

import {
  resolvePinnedUpdateTarget,
  validatePinnedTargetVersion,
} from '../update-system.mjs';

const SHA = 'a'.repeat(40);

test('update fetch pins explicit main without tags', () => {
  const calls = [];
  const git = (...args) => {
    calls.push(args);
    if (args[0] === 'fetch') return '';
    if (args[0] === 'rev-parse') return SHA;
    throw new Error(`unexpected git call: ${args.join(' ')}`);
  };

  assert.equal(resolvePinnedUpdateTarget({ ctx: { git } }), SHA);
  assert.deepEqual(calls[0], [
    'fetch',
    '--no-tags',
    'https://github.com/santifer/career-ops.git',
    'refs/heads/main',
  ]);
  assert.deepEqual(calls[1], ['rev-parse', '--verify', 'FETCH_HEAD^{commit}']);
});

test('self-reexec validates and reuses the supplied immutable commit', () => {
  const calls = [];
  const git = (...args) => {
    calls.push(args);
    return SHA;
  };

  assert.equal(resolvePinnedUpdateTarget({ reexec: true, suppliedSha: SHA, ctx: { git } }), SHA);
  assert.deepEqual(calls, [['rev-parse', '--verify', `${SHA}^{commit}`]]);
  assert.throws(
    () => resolvePinnedUpdateTarget({ reexec: true, suppliedSha: 'FETCH_HEAD', ctx: { git } }),
    /missing a valid pinned target commit/,
  );
});

test('target VERSION refuses downgrade and accepts equal or newer versions', () => {
  const withVersion = (version) => ({ git: (...args) => {
    assert.deepEqual(args, ['show', `${SHA}:VERSION`]);
    return `${version}\n`;
  } });

  assert.equal(validatePinnedTargetVersion('1.30.0', SHA, withVersion('1.30.0')), '1.30.0');
  assert.equal(validatePinnedTargetVersion('1.30.0', SHA, withVersion('1.31.0')), '1.31.0');
  assert.throws(
    () => validatePinnedTargetVersion('1.30.0', SHA, withVersion('1.29.9')),
    /older than installed VERSION 1\.30\.0; refusing to downgrade/,
  );
  assert.throws(
    () => validatePinnedTargetVersion('1.30.0', SHA, withVersion('not-a-version')),
    /no valid VERSION/,
  );
});
