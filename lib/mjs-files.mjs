import { readdirSync } from 'fs';
import { join } from 'path';

export const SKIP_DIRS = new Set([
  '.git', 'node_modules', 'output', 'data', 'coverage', 'test-results',
]);

/** Return every repository .mjs source file recursively and deterministically. */
export function collectMjsFiles(root) {
  const files = [];
  const walk = (dir, isRoot) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      // A child can disappear during a checkout; a missing root must remain a
      // hard failure so a syntax gate never passes after checking zero files.
      if (err?.code === 'ENOENT' && !isRoot) return;
      throw err;
    }
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry.name) || entry.isSymbolicLink()) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full, false);
      else if (entry.name.endsWith('.mjs')) files.push(full);
    }
  };
  walk(root, true);
  return files.sort();
}
