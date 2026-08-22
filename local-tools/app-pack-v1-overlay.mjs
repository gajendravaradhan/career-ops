#!/usr/bin/env node

/**
 * Install or verify the user-layer configuration for the app-pack-v1 overlay.
 *
 * The Git tag carries this installer and the application packager. The two
 * runtime configuration files are intentionally ignored user files, so this
 * installer updates only one marker-delimited block and one local-path entry.
 * Everything else in those files is preserved.
 */

import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { randomUUID } from 'node:crypto';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const OVERLAY_NAME = 'app-pack-v1';
export const START_MARKER = '<!-- app-pack-v1:start -->';
export const END_MARKER = '<!-- app-pack-v1:end -->';
export const LOCAL_PATH_ENTRY = 'local-tools/';

export const WORKFLOW_BLOCK = [
  START_MARKER,
  '### Application packages (`app-pack-v1`)',
  '',
  '- Keep canonical career-ops records in `reports/`, `jds/`, `data/`, and `data/pdf-index.tsv`.',
  '- Organize generated application material under `output/{Company}/{Report-Company-Role}/`.',
  '- For every evaluated role with a report, initialize or refresh the package first with `node local-tools/application-package.mjs --report {report} --company "{company}" --role "{role}"`. Use the printed `cv/tailored/vNNN/cv.html` and `cv/tailored/vNNN/cv.pdf` paths when the generator accepts explicit destinations, so new artifacts are created in the package directly; keep the report/JD copies, cover letter, interview prep, and reuse decision in the same package.',
  '- Apply this packaging rule to auto-pipeline, pipeline, batch, PDF, LaTeX, cover-letter, and direct tailoring workflows. If an updater-owned generator can only write a flat `output/` HTML/PDF, let it finish and then run the local packager with `--cv-html {flat-html} --cv-pdf {flat-pdf} --format {letter|a4} --migrate`; never edit the updater-owned mode or generator merely to change its output path.',
  '- Treat `cv/tailored/vNNN` and its matching source-CV snapshot as immutable. Reuse the same version only when its bytes are unchanged; otherwise choose the next `--version`. Missing optional artifacts remain `null` in `application.json` until they are genuinely generated.',
  '- Never move or delete canonical reports or JDs to organize output. A migration may remove only legacy CV HTML/PDF files after the package and PDF manifest are verified.',
  '- `package application {report} {company} {role}` means: run the local packager, resolve the canonical report and JD, create the nested package, copy role-specific artifacts, and preserve the root tracker/report/JD links.',
  '- Prefer nested package paths for all new CV/PDF artifacts. Use `--report {report}` when rendering PDFs so `data/pdf-index.tsv` points to the nested artifact.',
  '- Never customize `package.json`, `docs/`, `modes/_shared.md`, system mode files, or root system scripts to enforce this layout. Keep its implementation under declared `local-tools/` and its workflow rules inside this marker-delimited block.',
  '- After a raw upstream reset or a fresh checkout that retains this Git tag, restore the overlay with `git cherry-pick app-pack-v1`, then run `node local-tools/app-pack-v1-overlay.mjs apply` and `node local-tools/app-pack-v1-overlay.mjs verify`.',
  END_MARKER,
].join('\n');

export const REQUIRED_OVERLAY_FILES = [
  'local-tools/application-package.mjs',
  'local-tools/application-package.test.mjs',
  'local-tools/app-pack-v1-overlay.mjs',
  'local-tools/app-pack-v1-overlay.test.mjs',
  'local-tools/APP_PACK_V1.md',
];

const DEFAULT_ROOT = resolve(dirname(dirname(fileURLToPath(import.meta.url))));
const LOCAL_PATHS_FILE = 'config/local-paths.txt';
const CUSTOM_FILE = 'modes/_custom.md';
const CUSTOM_TEMPLATE = 'modes/_custom.template.md';

function overlayError(message) {
  return new Error(`${OVERLAY_NAME}: ${message}`);
}

function countOccurrences(value, token) {
  return value.split(token).length - 1;
}

function newlineOf(value) {
  return value.includes('\r\n') ? '\r\n' : '\n';
}

function isInside(root, candidate) {
  const rel = relative(resolve(root), resolve(candidate));
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`));
}

function safeTarget(rootValue, relativePath) {
  const root = resolve(rootValue);
  if (!existsSync(root)) throw overlayError(`workspace root does not exist: ${root}`);

  const rootStat = lstatSync(root);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw overlayError(`workspace root must be a real directory: ${root}`);
  }

  const target = resolve(root, relativePath);
  if (!isInside(root, target)) throw overlayError(`target escapes workspace: ${relativePath}`);

  const segments = relative(root, dirname(target)).split(sep).filter(Boolean);
  let current = root;
  for (const segment of segments) {
    current = join(current, segment);
    if (!existsSync(current)) {
      mkdirSync(current);
      continue;
    }
    const stat = lstatSync(current);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw overlayError(`parent must be a real directory: ${relative(root, current)}`);
    }
  }

  if (existsSync(target)) {
    const stat = lstatSync(target);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw overlayError(`target must be a regular file: ${relativePath}`);
    }
  }
  return target;
}

function readOptional(pathValue) {
  return existsSync(pathValue) ? readFileSync(pathValue, 'utf8') : '';
}

function atomicWrite(pathValue, content) {
  const priorMode = existsSync(pathValue) ? lstatSync(pathValue).mode & 0o777 : 0o644;
  const temporary = join(
    dirname(pathValue),
    `.${basename(pathValue)}.${process.pid}.${randomUUID()}.tmp`,
  );
  let descriptor;
  try {
    descriptor = openSync(temporary, 'wx', priorMode);
    writeFileSync(descriptor, content, 'utf8');
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    renameSync(temporary, pathValue);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}

function localPathsContent(source) {
  const eol = newlineOf(source);
  const lines = source ? source.split(/\r?\n/) : [];
  const result = [];
  let found = false;

  for (const line of lines) {
    if (line.trim() === LOCAL_PATH_ENTRY) {
      if (found) continue;
      found = true;
      result.push(LOCAL_PATH_ENTRY);
    } else {
      result.push(line);
    }
  }

  while (result.length && result.at(-1) === '') result.pop();
  if (!found) {
    if (result.length) result.push('');
    result.push(LOCAL_PATH_ENTRY);
  }
  if (!result.length) result.push(LOCAL_PATH_ENTRY);
  return `${result.join(eol)}${eol}`;
}

function validateMarkers(source) {
  const starts = countOccurrences(source, START_MARKER);
  const ends = countOccurrences(source, END_MARKER);
  if (starts === 0 && ends === 0) return null;
  if (starts !== 1 || ends !== 1) {
    throw overlayError(`expected zero or one complete marker block; found ${starts} start and ${ends} end markers`);
  }
  const start = source.indexOf(START_MARKER);
  const end = source.indexOf(END_MARKER);
  if (end < start) throw overlayError('workflow block end marker precedes its start marker');
  return { start, end: end + END_MARKER.length };
}

function insertIntoCustomWorkflows(source, block, eol) {
  const header = /^## Custom Workflows[ \t]*$/m.exec(source);
  if (!header) {
    const prefix = source.replace(/[ \t]*(?:\r?\n)*$/, '');
    return `${prefix}${prefix ? `${eol}${eol}` : ''}## Custom Workflows${eol}${eol}${block}${eol}`;
  }

  const sectionStart = header.index + header[0].length;
  const remainder = source.slice(sectionStart);
  const nextSection = /^## [^#\r\n].*$/m.exec(remainder);
  const insertionPoint = nextSection ? sectionStart + nextSection.index : source.length;
  const before = source.slice(0, insertionPoint).replace(/[ \t]*(?:\r?\n)*$/, '');
  const after = source.slice(insertionPoint).replace(/^(?:[ \t]*\r?\n)*/, '');
  return `${before}${eol}${eol}${block}${after ? `${eol}${eol}${after}` : eol}`;
}

function customContent(source, templateSource = '') {
  const base = source || templateSource || '# Custom Instructions -- career-ops\n\n## Custom Workflows\n';
  const eol = newlineOf(base);
  const block = WORKFLOW_BLOCK.replace(/\n/g, eol);
  const markerRange = validateMarkers(base);

  let result;
  if (markerRange) {
    result = `${base.slice(0, markerRange.start)}${block}${base.slice(markerRange.end)}`;
  } else {
    result = insertIntoCustomWorkflows(base, block, eol);
  }
  return `${result.replace(/[ \t]*(?:\r?\n)*$/, '')}${eol}`;
}

function regularFileStatus(root, relativePath) {
  const pathValue = resolve(root, relativePath);
  if (!isInside(root, pathValue) || !existsSync(pathValue)) return false;
  const stat = lstatSync(pathValue);
  return stat.isFile() && !stat.isSymbolicLink();
}

export function overlayStatus(rootValue = DEFAULT_ROOT) {
  const root = resolve(rootValue);
  const localPathsPath = safeTarget(root, LOCAL_PATHS_FILE);
  const customPath = safeTarget(root, CUSTOM_FILE);
  const localPaths = readOptional(localPathsPath);
  const custom = readOptional(customPath);
  const eol = newlineOf(custom);
  const expectedBlock = WORKFLOW_BLOCK.replace(/\n/g, eol);
  const localPathCount = localPaths
    .split(/\r?\n/)
    .filter((line) => line.trim() === LOCAL_PATH_ENTRY)
    .length;
  const startCount = countOccurrences(custom, START_MARKER);
  const endCount = countOccurrences(custom, END_MARKER);
  const requiredFiles = Object.fromEntries(
    REQUIRED_OVERLAY_FILES.map((file) => [file, regularFileStatus(root, file)]),
  );
  const filesPresent = Object.values(requiredFiles).every(Boolean);
  const workflowInstalled = startCount === 1 && endCount === 1 && custom.includes(expectedBlock);

  return {
    name: OVERLAY_NAME,
    root,
    installed: localPathCount === 1 && workflowInstalled && filesPresent,
    localPath: { installed: localPathCount === 1, count: localPathCount },
    workflow: { installed: workflowInstalled, startMarkers: startCount, endMarkers: endCount },
    requiredFiles,
  };
}

export function verifyOverlay(rootValue = DEFAULT_ROOT) {
  const status = overlayStatus(rootValue);
  const issues = [];
  if (!status.localPath.installed) {
    issues.push(`${LOCAL_PATHS_FILE} must contain exactly one ${LOCAL_PATH_ENTRY} entry`);
  }
  if (!status.workflow.installed) {
    issues.push(`${CUSTOM_FILE} does not contain the exact ${OVERLAY_NAME} workflow block`);
  }
  for (const [file, present] of Object.entries(status.requiredFiles)) {
    if (!present) issues.push(`missing overlay file: ${file}`);
  }
  if (issues.length) throw overlayError(`verification failed:\n- ${issues.join('\n- ')}`);
  return status;
}

export function applyOverlay(rootValue = DEFAULT_ROOT) {
  const root = resolve(rootValue);
  const localPathsPath = safeTarget(root, LOCAL_PATHS_FILE);
  const customPath = safeTarget(root, CUSTOM_FILE);
  const templatePath = safeTarget(root, CUSTOM_TEMPLATE);

  const priorLocalPaths = readOptional(localPathsPath);
  const priorCustom = readOptional(customPath);
  const template = readOptional(templatePath);

  // Compute and validate both files before writing either one.
  const nextLocalPaths = localPathsContent(priorLocalPaths);
  const nextCustom = customContent(priorCustom, template);
  const changedFiles = [];

  if (nextLocalPaths !== priorLocalPaths) {
    atomicWrite(localPathsPath, nextLocalPaths);
    changedFiles.push(LOCAL_PATHS_FILE);
  }
  if (nextCustom !== priorCustom) {
    atomicWrite(customPath, nextCustom);
    changedFiles.push(CUSTOM_FILE);
  }

  return { ...verifyOverlay(root), changedFiles };
}

function usage() {
  return [
    `Usage: node local-tools/app-pack-v1-overlay.mjs <apply|verify|status> [--root PATH]`,
    '',
    '  apply   Install or refresh the bounded user-layer configuration, then verify it.',
    '  verify  Fail unless the tagged overlay and its user-layer configuration are complete.',
    '  status  Print installation status without requiring a complete installation.',
  ].join('\n');
}

function parseCli(argv) {
  const args = [...argv];
  const command = args[0] && !args[0].startsWith('-') ? args.shift() : 'status';
  let root = DEFAULT_ROOT;
  while (args.length) {
    const option = args.shift();
    if (option === '--root' && args.length) root = resolve(args.shift());
    else if (option === '--help' || option === '-h') return { help: true };
    else throw overlayError(`unknown or incomplete option: ${option}`);
  }
  if (!['apply', 'verify', 'status'].includes(command)) {
    throw overlayError(`unknown command: ${command}`);
  }
  return { command, root, help: false };
}

function main() {
  try {
    const options = parseCli(process.argv.slice(2));
    if (options.help) {
      process.stdout.write(`${usage()}\n`);
      return;
    }
    const result = options.command === 'apply'
      ? applyOverlay(options.root)
      : options.command === 'verify'
        ? verifyOverlay(options.root)
        : overlayStatus(options.root);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (options.command === 'status' && !result.installed) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`${error.message}\n\n${usage()}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
