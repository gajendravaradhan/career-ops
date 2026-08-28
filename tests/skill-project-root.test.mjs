import { execFileSync } from 'child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join, relative, resolve, sep } from 'path';
import { fail, pass, ROOT } from './helpers.mjs';

console.log('\nSkill project-root resolution (#3332)');

const entrypoints = [
  '.agents',
  '.antigravitycli',
  '.claude',
  '.cursor',
  '.grok',
  '.kimi',
  '.opencode',
  '.qwen',
].map(dir => join(dir, 'skills', 'career-ops', 'SKILL.md'));

function findProjectRoot(skillPath) {
  let current = dirname(skillPath);
  while (true) {
    if (existsSync(join(current, 'AGENTS.md')) && existsSync(join(current, 'modes'))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

// With core.symlinks=false (the default non-privileged Windows checkout), git
// materializes a mode-120000 entry as a regular text file containing the link
// target. Ask git for the entry type; lstat cannot distinguish that pointer
// file from the real document on the affected checkout (#3364).
function isGitSymlink(relativePath) {
  const entry = execFileSync('git', ['ls-files', '-s', '--', relativePath], {
    cwd: ROOT,
    encoding: 'utf8',
  }).trim();
  return entry.startsWith('120000 ');
}

function readSkillText(skillPath, gitSymlink, allowedRoot = ROOT) {
  const text = readFileSync(skillPath, 'utf8');
  if (!gitSymlink || text.includes('\n')) return text;

  const target = resolve(dirname(skillPath), text.trim());
  const rel = relative(allowedRoot, target);
  if ((rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..')) && existsSync(target)) {
    return readFileSync(target, 'utf8');
  }
  return text;
}

const failures = [];
for (const relativePath of entrypoints) {
  const skillPath = join(ROOT, relativePath);
  const text = readSkillText(skillPath, isGitSymlink(relativePath));
  const resolvedRoot = findProjectRoot(skillPath);

  if (resolve(resolvedRoot || '') !== resolve(ROOT)) {
    failures.push(`${relativePath}: resolved ${resolvedRoot || '(none)'}`);
  }
  if (!text.includes('Resolve every path in this router') ||
      !text.includes("never against the process's current working directory")) {
    failures.push(`${relativePath}: missing cwd-independent routing rule`);
  }
}

// Exercise the pointer-file branch on every platform; a symlink-capable CI
// checkout otherwise follows the link before Node can observe this shape.
const fixture = mkdtempSync(join(tmpdir(), 'co-skill-pointer-'));
try {
  const canonical = join(fixture, 'canonical', 'SKILL.md');
  const pointer = join(fixture, 'mirror', 'SKILL.md');
  mkdirSync(dirname(canonical), { recursive: true });
  mkdirSync(dirname(pointer), { recursive: true });
  writeFileSync(canonical, 'Resolve every path in this router\n');
  writeFileSync(pointer, '../canonical/SKILL.md');
  if (!readSkillText(pointer, true, fixture).includes('Resolve every path in this router')) {
    failures.push('Windows-style pointer fixture was not resolved');
  }
} finally {
  rmSync(fixture, { recursive: true, force: true });
}

if (failures.length === 0) {
  pass('all CLI skill entrypoints resolve modes/ from the checkout root, not cwd');
} else {
  fail(failures.join(' | '));
}
