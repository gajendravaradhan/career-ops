#!/usr/bin/env node

/**
 * Local, updater-safe application packager.
 *
 * This file intentionally has no imports from the career-ops system layer. It
 * is a user-owned local tool: the package layout and the canonical pipeline
 * files are coupled only through the small, documented contracts below.
 */

import {
  closeSync,
  copyFileSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';

const DEFAULT_ROOT = resolve(dirname(dirname(fileURLToPath(import.meta.url))));
const VALID_FORMATS = new Set(['letter', 'a4']);
const RESERVED_REPORT_SUFFIX = '-RESERVED.md';
const RESERVED_WINDOWS_NAMES = new Set([
  'CON', 'PRN', 'AUX', 'NUL',
  'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
  'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9',
]);

function fail(message) {
  return new Error(`application-package: ${message}`);
}

function reportNumber(value) {
  const raw = String(value ?? '').trim();
  if (!/^\d+$/.test(raw)) throw fail('report must be a numeric report number');
  return raw.padStart(3, '0');
}

function versionNumber(value) {
  const raw = String(value ?? '1').trim();
  if (!/^\d+$/.test(raw) || Number(raw) < 1) {
    throw fail('version must be a positive integer');
  }
  return raw;
}

function normalizedReportKey(value) {
  const raw = String(value ?? '').trim();
  return raw.replace(/^0+(?=\d)/, '') || '0';
}

/**
 * Make a human-readable company directory name that is exactly one path
 * segment. Separators and traversal are rejected rather than guessed at.
 */
export function safeCompanyDirectory(value) {
  const raw = String(value ?? '').trim();
  if (!raw) throw fail('company must be non-empty');
  if (raw === '.' || raw === '..' || /[\\/]/.test(raw)) {
    throw fail('company must be one path segment and cannot contain traversal or path separators');
  }
  if (raw.includes('\u0000')) throw fail('company contains a NUL character');

  const safe = raw
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f]/g, '-')
    .replace(/[<>:"|?*]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();

  if (!safe || safe === '.' || safe === '..' || /[\\/]/.test(safe)) {
    throw fail('company becomes an empty or traversal directory name');
  }
  const deviceName = safe.split('.')[0].trim().toUpperCase();
  if (RESERVED_WINDOWS_NAMES.has(deviceName)) {
    throw fail(`company uses a reserved directory name: ${safe}`);
  }
  if (Buffer.byteLength(safe, 'utf8') > 180) {
    throw fail('company directory name is too long');
  }
  return safe;
}

function slugify(value, fallback, maxLength = 100) {
  const slug = String(value ?? '')
    .normalize('NFKD')
    .replace(/[^\x00-\x7f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const resolvedSlug = slug || fallback;
  if (resolvedSlug.length <= maxLength) return resolvedSlug;
  const suffix = createHash('sha256').update(String(value ?? '')).digest('hex').slice(0, 10);
  const prefix = resolvedSlug.slice(0, maxLength - suffix.length - 1).replace(/-+$/g, '');
  return `${prefix}-${suffix}`;
}

function lexicalInside(child, parent) {
  const rel = relative(resolve(parent), resolve(child));
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel));
}

function canonicalCandidate(pathValue) {
  let probe = resolve(pathValue);
  const tail = [];
  while (!existsSync(probe)) {
    const parent = dirname(probe);
    if (parent === probe) return resolve(pathValue);
    tail.unshift(basename(probe));
    probe = parent;
  }
  return resolve(realpathSync(probe), ...tail);
}

/**
 * Return whether child is contained by parent after resolving existing
 * symlinked ancestors. Equality is considered contained.
 */
function containsPath(child, parent) {
  try {
    if (!lexicalInside(child, parent)) return false;
    const canonicalChild = canonicalCandidate(child);
    const canonicalParent = canonicalCandidate(parent);
    return lexicalInside(canonicalChild, canonicalParent);
  } catch {
    return false;
  }
}

/**
 * Return whether candidate is contained by container after resolving existing
 * symlinked ancestors. The public helper uses the intuitive
 * isPathInside(container, candidate) order; internal callers use the
 * explicitly named containsPath(child, parent) to avoid argument ambiguity.
 */
export function isPathInside(container, candidate) {
  return containsPath(candidate, container);
}

function assertInside(child, parent, label) {
  if (!containsPath(child, parent)) {
    throw fail(`${label} escapes its allowed workspace: ${child}`);
  }
  return resolve(child);
}

function assertRegularFile(pathValue, label, { missing = false } = {}) {
  let stat;
  try {
    stat = lstatSync(pathValue);
  } catch (error) {
    if (missing && error?.code === 'ENOENT') return null;
    if (error?.code === 'ENOENT') throw fail(`${label} not found: ${pathValue}`);
    throw fail(`cannot inspect ${label}: ${pathValue} (${error.message})`);
  }
  if (stat.isSymbolicLink()) throw fail(`${label} must not be a symlink: ${pathValue}`);
  if (!stat.isFile()) throw fail(`${label} must be a regular file: ${pathValue}`);
  return pathValue;
}

function resolveInput(value, root, label, { optional = false } = {}) {
  if (value == null || String(value).trim() === '') {
    if (optional) return null;
    throw fail(`${label} must be a non-empty file path`);
  }
  const candidate = isAbsolute(String(value)) ? resolve(String(value)) : resolve(root, String(value));
  return assertRegularFile(candidate, label, { missing: optional });
}

function repoRelative(pathValue, root, label) {
  assertInside(pathValue, root, label);
  return relative(resolve(root), resolve(pathValue)).split(sep).join('/');
}

function portableSourceLabel(pathValue, root) {
  if (containsPath(pathValue, root)) return repoRelative(pathValue, root, 'source path');
  return `external/${basename(pathValue)}`;
}

function fileHash(pathValue) {
  const hash = createHash('sha256');
  hash.update(readFileSync(pathValue));
  return hash.digest('hex');
}

function fileBytes(pathValue) {
  return lstatSync(pathValue).size;
}

function fsyncFile(pathValue) {
  const fd = openSync(pathValue, 'r');
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function tempPath(destination) {
  return `${destination}.tmp-${process.pid}-${randomUUID()}`;
}

function atomicWrite(destination, contents) {
  mkdirSync(dirname(destination), { recursive: true });
  const temporary = tempPath(destination);
  try {
    writeFileSync(temporary, contents);
    fsyncFile(temporary);
    renameSync(temporary, destination);
  } finally {
    if (existsSync(temporary)) rmSync(temporary, { force: true });
  }
}

function atomicCopy(source, destination) {
  assertRegularFile(source, 'copy source');
  const sourceHashBefore = fileHash(source);
  if (resolve(source) === resolve(destination)) return sourceHashBefore;
  mkdirSync(dirname(destination), { recursive: true });
  if (existsSync(destination)) {
    assertRegularFile(destination, 'package destination');
    if (fileHash(destination) === sourceHashBefore) return sourceHashBefore;
  }
  const temporary = tempPath(destination);
  try {
    copyFileSync(source, temporary);
    fsyncFile(temporary);
    const copiedHash = fileHash(temporary);
    const sourceHashAfter = fileHash(source);
    if (sourceHashBefore !== sourceHashAfter || copiedHash !== sourceHashBefore) {
      throw fail(`source changed or failed verification while copying: ${source}`);
    }
    renameSync(temporary, destination);
  } finally {
    if (existsSync(temporary)) rmSync(temporary, { force: true });
  }
  return sourceHashBefore;
}

function atomicCopyImmutableVersion(source, destination, label) {
  if (existsSync(destination)) {
    assertRegularFile(destination, `${label} destination`);
    const existingHash = fileHash(destination);
    const sourceHash = fileHash(source);
    if (existingHash !== sourceHash) {
      throw fail(`${label} already exists with different bytes at ${destination}; choose another --version`);
    }
    return existingHash;
  }
  return atomicCopy(source, destination);
}

function assertImmutableVersionCompatible(source, destination, label) {
  if (!source || !existsSync(destination)) return;
  assertRegularFile(destination, `${label} destination`);
  if (fileHash(destination) !== fileHash(source)) {
    throw fail(`${label} already exists with different bytes at ${destination}; choose another --version`);
  }
}

function writeJsonIfChanged(destination, value) {
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  if (existsSync(destination)) {
    assertRegularFile(destination, 'JSON destination');
    if (readFileSync(destination, 'utf8') === serialized) return false;
  }
  atomicWrite(destination, serialized);
  return true;
}

function readJsonObject(pathValue, label) {
  if (!existsSync(pathValue)) return null;
  assertRegularFile(pathValue, label);
  try {
    const value = JSON.parse(readFileSync(pathValue, 'utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('top-level value must be an object');
    }
    return value;
  } catch (error) {
    throw fail(`${label} is not valid JSON: ${pathValue} (${error.message})`);
  }
}

function matchCanonicalFiles(directory, prefix) {
  if (!existsSync(directory)) return [];
  const matches = readdirSync(directory)
    .filter((name) => name.startsWith(`${prefix}-`) && name.endsWith('.md') && !name.endsWith(RESERVED_REPORT_SUFFIX))
    .sort()
    .map((name) => join(directory, name));
  return matches.map((pathValue) => assertRegularFile(pathValue, 'canonical file'));
}

function resolveCanonical(directory, prefix, label, { required = false } = {}) {
  const matches = matchCanonicalFiles(directory, prefix);
  if (matches.length > 1) {
    throw fail(`ambiguous ${label} for report ${prefix}: ${matches.map((pathValue) => basename(pathValue)).join(', ')}`);
  }
  if (!matches.length && required) throw fail(`no canonical ${label} found for report #${prefix}`);
  return matches[0] || null;
}

function manifestPathToAbsolute(value, root, label) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  if (isAbsolute(raw) || /^[A-Za-z]:[\\/]/.test(raw) || raw.includes('\\') || raw.includes('\u0000')) {
    throw fail(`${label} in data/pdf-index.tsv must be a workspace-relative forward-slash path`);
  }
  const candidate = resolve(root, raw);
  assertInside(candidate, root, label);
  return candidate;
}

function readPdfManifest(root, report) {
  const manifestPath = join(root, 'data', 'pdf-index.tsv');
  if (!existsSync(manifestPath)) return { path: manifestPath, lines: [], row: null };
  assertInside(manifestPath, root, 'PDF index');
  assertRegularFile(manifestPath, 'PDF index');
  const lines = readFileSync(manifestPath, 'utf8').split(/\r?\n/);
  let row = null;
  for (const line of lines) {
    if (!line.trim() || line.startsWith('#')) continue;
    const fields = line.split('\t');
    if (fields.length < 3) continue;
    const pdf = manifestPathToAbsolute(fields[1], root, 'PDF index PDF path');
    const html = manifestPathToAbsolute(fields[2], root, 'PDF index HTML path');
    const candidate = {
      report: fields[0].trim(),
      pdf,
      html,
      format: fields[3]?.trim() || null,
      date: fields[4]?.trim() || null,
    };
    if (normalizedReportKey(candidate.report) === normalizedReportKey(report)) {
      if (row) throw fail(`ambiguous PDF index rows for report #${report}`);
      row = candidate;
    }
  }
  if (row?.pdf) assertRegularFile(row.pdf, 'PDF index PDF artifact', { missing: true });
  if (row?.html) assertRegularFile(row.html, 'PDF index HTML artifact', { missing: true });
  return { path: manifestPath, lines, row };
}

function extractCoverLetter(reportText) {
  const heading = reportText.match(/^##\s+(?:Cover Letter Draft|Draft Cover Letter)\s*$/m);
  if (!heading || heading.index == null) return null;
  const start = heading.index + heading[0].length;
  const remainder = reportText.slice(start).replace(/^\r?\n/, '');
  const nextHeading = remainder.search(/^##\s/m);
  const cover = remainder.slice(0, nextHeading < 0 ? remainder.length : nextHeading).trim();
  return cover || null;
}

function packagePaths(root, report, company, role, version) {
  const outputRoot = join(root, 'output');
  const companyDirectory = safeCompanyDirectory(company);
  const companyRoot = join(outputRoot, companyDirectory);
  const key = `${report}-${slugify(company, 'company', 60)}-${slugify(role, 'role', 120)}`;
  const packageRoot = join(companyRoot, key);
  assertInside(outputRoot, root, 'output root');
  assertInside(companyRoot, outputRoot, 'company directory');
  assertInside(packageRoot, outputRoot, 'application package');
  const versionTag = `v${version.padStart(3, '0')}`;
  const tailoredRoot = join(packageRoot, 'cv', 'tailored', versionTag);
  const paths = {
    root: packageRoot,
    report: join(packageRoot, 'report', 'evaluation.md'),
    jd: join(packageRoot, 'jd', 'current.md'),
    coverLetter: join(packageRoot, 'cover-letter', 'cover-letter.md'),
    sourceCv: version === '1'
      ? join(packageRoot, 'cv', 'source', 'cv.md')
      : join(packageRoot, 'cv', 'source', versionTag, 'cv.md'),
    tailoredHtml: join(tailoredRoot, 'cv.html'),
    tailoredPdf: join(tailoredRoot, 'cv.pdf'),
    changes: join(tailoredRoot, 'changes.md'),
    decision: join(packageRoot, 'decision', 'reuse.json'),
    manifest: join(packageRoot, 'application.json'),
    interviewPrep: join(packageRoot, 'interview-prep'),
  };
  for (const [label, pathValue] of Object.entries(paths)) {
    assertInside(pathValue, packageRoot, `package ${label}`);
  }
  const directories = [
    dirname(paths.report),
    dirname(paths.jd),
    dirname(paths.coverLetter),
    dirname(paths.sourceCv),
    tailoredRoot,
    dirname(paths.decision),
    paths.interviewPrep,
  ];
  for (const directory of directories) {
    assertInside(directory, packageRoot, 'package directory');
  }
  return { outputRoot, companyDirectory, key, tailoredRoot, directories, ...paths };
}

function existingFile(pathValue, label) {
  return existsSync(pathValue) ? assertRegularFile(pathValue, label) : null;
}

function artifactProvenance(source, destination, root, kind = 'copied') {
  if (!destination) return null;
  const destinationHash = fileHash(destination);
  const destinationBytes = fileBytes(destination);
  if (!source) {
    return {
      kind: 'preserved',
      source: repoRelative(destination, root, 'preserved artifact'),
      sha256: destinationHash,
      source_sha256: destinationHash,
      destination_sha256: destinationHash,
      bytes: destinationBytes,
    };
  }
  return {
    kind,
    source: portableSourceLabel(source, root),
    sha256: fileHash(source),
    source_sha256: fileHash(source),
    destination_sha256: destinationHash,
    bytes: destinationBytes,
  };
}

function normalizeDecision(value, root) {
  const normalized = { ...value };
  for (const key of ['source_cv', 'current_jd', 'previous_source']) {
    if (typeof normalized[key] !== 'string' || !isAbsolute(normalized[key])) continue;
    normalized[key] = containsPath(normalized[key], root)
      ? repoRelative(normalized[key], root, `decision ${key}`)
      : `external/${basename(normalized[key])}`;
  }
  return normalized;
}

function ensureDecision(pathValue, root, sourceCvPath, jdPath, dryRun, existingDecision = undefined) {
  const newDecision = {
    schema_version: 1,
    decision: 'regenerate',
    score: null,
    source_cv: sourceCvPath ? repoRelative(sourceCvPath, root, 'source CV') : null,
    current_jd: jdPath ? repoRelative(jdPath, root, 'current JD') : null,
    previous_source: null,
    changed_sections: [],
    user_override: false,
    recorded_at: new Date().toISOString(),
  };
  const existing = existingDecision === undefined
    ? readJsonObject(pathValue, 'reuse decision')
    : existingDecision;
  if (!existing) {
    if (!dryRun) writeJsonIfChanged(pathValue, newDecision);
    return newDecision;
  }
  const normalized = normalizeDecision(existing, root);
  if (!dryRun && JSON.stringify(normalized) !== JSON.stringify(existing)) {
    writeJsonIfChanged(pathValue, normalized);
  }
  return normalized;
}

function updatePdfManifest(root, manifest, report, htmlDestination, pdfDestination, format, dryRun) {
  if (!htmlDestination || !pdfDestination) return { updated: false, format: null, date: null };
  const prior = manifest.row;
  const chosenFormat = format || prior?.format;
  if (!chosenFormat || !VALID_FORMATS.has(chosenFormat)) {
    throw fail(`both HTML and PDF are present but no valid format is available; pass --format=letter or --format=a4`);
  }
  const chosenDate = prior?.date || new Date().toISOString().slice(0, 10);
  const header = manifest.lines.find((line) => line.startsWith('# report\t'))
    || '# report\tpdf\thtml\tformat\tdate — written by generate-pdf.mjs, do not edit';
  const pdfRel = repoRelative(pdfDestination, root, 'PDF index PDF destination');
  const htmlRel = repoRelative(htmlDestination, root, 'PDF index HTML destination');
  const replacement = [report, pdfRel, htmlRel, chosenFormat, chosenDate].join('\t');
  const kept = [];
  let inserted = false;
  for (const line of manifest.lines) {
    if (!line.trim() || line.startsWith('#')) continue;
    const fields = line.split('\t');
    if (fields.length < 3) continue;
    const existingPdf = manifestPathToAbsolute(fields[1], root, 'PDF index PDF path');
    const matches = normalizedReportKey(fields[0]) === normalizedReportKey(report)
      || existingPdf === resolve(pdfDestination);
    if (matches) {
      if (!inserted) {
        kept.push(replacement);
        inserted = true;
      }
      continue;
    }
    kept.push(line);
  }
  if (!inserted) kept.push(replacement);
  const next = `${header}\n${kept.join('\n')}\n`;
  const current = existsSync(manifest.path) ? readFileSync(manifest.path, 'utf8') : '';
  if (!dryRun && current !== next) atomicWrite(manifest.path, next);
  return { updated: current !== next, format: chosenFormat, date: chosenDate };
}

const PDF_INDEX_LOCK_TIMEOUT_MS = 10_000;
const PDF_INDEX_LOCK_POLL_MS = 25;

function waitBriefly(milliseconds) {
  const signal = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(signal, 0, 0, milliseconds);
}

function acquirePdfIndexLock(root) {
  const lockPath = join(root, 'data', 'pdf-index.tsv.lock');
  const token = randomUUID();
  mkdirSync(dirname(lockPath), { recursive: true });
  const started = Date.now();
  while (true) {
    try {
      mkdirSync(lockPath);
      try {
        atomicWrite(join(lockPath, 'owner.json'), `${JSON.stringify({ token, pid: process.pid, acquired_at: new Date().toISOString() })}\n`);
      } catch (error) {
        rmSync(lockPath, { recursive: true, force: true });
        throw fail(`could not initialize PDF index lock: ${error.message}`);
      }
      let released = false;
      return () => {
        if (released) return;
        released = true;
        try {
          const owner = JSON.parse(readFileSync(join(lockPath, 'owner.json'), 'utf8'));
          if (owner?.token === token) rmSync(lockPath, { recursive: true, force: true });
        } catch {
          // Missing/malformed/replaced ownership means this process no longer
          // has authority to remove the path. Leave it for explicit review.
        }
      };
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      if (Date.now() - started >= PDF_INDEX_LOCK_TIMEOUT_MS) {
        let owner = 'owner metadata unavailable';
        try {
          owner = readFileSync(join(lockPath, 'owner.json'), 'utf8').trim();
        } catch {
          // A crashed process may leave only the lock directory. Fail closed:
          // automatically deleting a lock can steal it from a fresh owner.
        }
        throw fail(`timed out waiting for PDF index lock: ${lockPath} (${owner}); inspect and remove it only after confirming no packager is running`);
      }
      waitBriefly(PDF_INDEX_LOCK_POLL_MS);
    }
  }
}

function withPdfIndexLock(root, callback) {
  const release = acquirePdfIndexLock(root);
  try {
    return callback();
  } finally {
    release();
  }
}

function directLegacyFile(pathValue, outputRoot) {
  if (!pathValue || dirname(resolve(pathValue)) !== resolve(outputRoot)) return false;
  const extension = extname(pathValue).toLowerCase();
  return extension === '.html' || extension === '.pdf';
}

function assertMigrationSource(pathValue, outputRoot, label) {
  if (!directLegacyFile(pathValue, outputRoot)) {
    throw fail(`--migrate may delete only a direct child .html or .pdf under ${outputRoot}; ${label} is ${pathValue}`);
  }
  assertInside(pathValue, outputRoot, `${label} migration source`);
  assertRegularFile(pathValue, `${label} migration source`);
}

function parseOptions(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      report: { type: 'string' },
      company: { type: 'string' },
      role: { type: 'string' },
      version: { type: 'string', default: '1' },
      'cv-html': { type: 'string' },
      'cv-pdf': { type: 'string' },
      'source-cv': { type: 'string' },
      jd: { type: 'string' },
      'cover-letter': { type: 'string' },
      migrate: { type: 'boolean', default: false },
      'dry-run': { type: 'boolean', default: false },
      format: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
    strict: true,
  });
  if (positionals.length) throw fail(`unexpected positional argument: ${positionals[0]}`);
  return values;
}

export function usage() {
  return `Usage: node local-tools/application-package.mjs --report N --company NAME --role ROLE [options]

Options:
  --version N          Tailored CV version (default: 1)
  --cv-html PATH       Tailored CV HTML to copy into the package
  --cv-pdf PATH        Tailored CV PDF to copy into the package
  --source-cv PATH     Source CV snapshot (v001 uses cv/source/cv.md; later versions are versioned)
  --jd PATH            Current JD; defaults to the unique matching jds/{report}-*.md
  --cover-letter PATH  Finished cover letter to copy into cover-letter/
  --format letter|a4   PDF index format when no prior row supplies one
  --migrate            Remove only explicit direct-child legacy CV files under output/
  --dry-run            Resolve and validate without writing or removing files
  --help, -h           Show this help
`;
}

/**
 * Package one application.
 *
 * @param {object} options CLI-equivalent option values
 * @param {object} context optional execution context; `root` is a workspace
 * root and exists primarily so tests can use a temporary workspace.
 */
export function runPackage(options, { root = DEFAULT_ROOT } = {}) {
  const input = { ...(options || {}) };
  const values = {
    ...input,
    'cv-html': input['cv-html'] ?? input.cvHtml,
    'cv-pdf': input['cv-pdf'] ?? input.cvPdf,
    'source-cv': input['source-cv'] ?? input.sourceCv,
    'cover-letter': input['cover-letter'] ?? input.coverLetter,
    'dry-run': input['dry-run'] ?? input.dryRun,
  };
  const workspaceRoot = resolve(root);
  const report = reportNumber(values.report);
  const company = String(values.company ?? '').trim();
  const role = String(values.role ?? '').trim();
  if (!company || !role) throw fail('company and role must be non-empty');
  const version = versionNumber(values.version);
  const format = values.format == null ? null : String(values.format).trim().toLowerCase();
  if (format && !VALID_FORMATS.has(format)) throw fail('format must be letter or a4');

  const paths = packagePaths(workspaceRoot, report, company, role, version);
  const reportsRoot = join(workspaceRoot, 'reports');
  const jdsRoot = join(workspaceRoot, 'jds');
  const canonicalReport = resolveCanonical(reportsRoot, report, 'report', { required: true });
  const explicitJd = values.jd != null
    ? resolveInput(values.jd, workspaceRoot, '--jd')
    : null;
  if (explicitJd) assertInside(explicitJd, workspaceRoot, '--jd');
  const canonicalJd = explicitJd || resolveCanonical(jdsRoot, report, 'JD');
  const reportText = readFileSync(canonicalReport, 'utf8');
  const manifest = readPdfManifest(workspaceRoot, report);

  const sourceCvExplicit = values['source-cv'] != null;
  const sourceCv = sourceCvExplicit
    ? resolveInput(values['source-cv'], workspaceRoot, '--source-cv')
    : resolveInput('cv.md', workspaceRoot, 'default source CV', { optional: true });
  const htmlSource = values['cv-html'] != null
    ? resolveInput(values['cv-html'], workspaceRoot, '--cv-html')
    : (manifest.row?.html && existsSync(manifest.row.html) ? assertRegularFile(manifest.row.html, 'manifest HTML') : null);
  const pdfSource = values['cv-pdf'] != null
    ? resolveInput(values['cv-pdf'], workspaceRoot, '--cv-pdf')
    : (manifest.row?.pdf && existsSync(manifest.row.pdf) ? assertRegularFile(manifest.row.pdf, 'manifest PDF') : null);
  const coverSource = values['cover-letter'] != null
    ? resolveInput(values['cover-letter'], workspaceRoot, '--cover-letter')
    : null;
  const extractedCover = coverSource ? null : extractCoverLetter(reportText);
  const existingSourceCv = existingFile(paths.sourceCv, 'existing source CV snapshot');
  const existingCover = existingFile(paths.coverLetter, 'existing cover letter');
  const existingTailoredHtml = existingFile(paths.tailoredHtml, 'existing tailored HTML');
  const existingTailoredPdf = existingFile(paths.tailoredPdf, 'existing tailored PDF');
  const existingChanges = existingFile(paths.changes, 'existing packaging notes');
  existingFile(paths.report, 'existing packaged report');
  existingFile(paths.jd, 'existing packaged JD');
  const existingDecision = readJsonObject(paths.decision, 'reuse decision');
  const existingApplication = readJsonObject(paths.manifest, 'application manifest');
  const incomingSourceHash = sourceCv ? fileHash(sourceCv) : null;
  if (existingSourceCv && sourceCv && fileHash(existingSourceCv) !== incomingSourceHash) {
    throw fail(`source CV snapshot already exists and differs: ${paths.sourceCv}; choose another --version`);
  }
  assertImmutableVersionCompatible(htmlSource, paths.tailoredHtml, 'tailored HTML');
  assertImmutableVersionCompatible(pdfSource, paths.tailoredPdf, 'tailored PDF');

  const plannedHtml = htmlSource || existingTailoredHtml;
  const plannedPdf = pdfSource || existingTailoredPdf;
  const plannedFormat = format || manifest.row?.format;
  if (plannedHtml && plannedPdf && !VALID_FORMATS.has(plannedFormat)) {
    throw fail('both HTML and PDF are present but no valid format is available; pass --format=letter or --format=a4');
  }

  const migrationSources = [];
  if (values.migrate) {
    for (const [flag, source] of [['--cv-html', htmlSource], ['--cv-pdf', pdfSource]]) {
      if (values[flag.slice(2)] != null && source) {
        assertMigrationSource(source, paths.outputRoot, flag);
        migrationSources.push(source);
      }
    }
    if (!migrationSources.length) {
      throw fail('--migrate requires at least one explicit --cv-html or --cv-pdf legacy file');
    }
  }

  const resolved = {
    root: paths.root,
    manifest: paths.manifest,
    report: paths.report,
    jd: canonicalJd ? paths.jd : null,
    coverLetter: coverSource || extractedCover || existingCover ? paths.coverLetter : null,
    sourceCv: sourceCv || existingSourceCv ? paths.sourceCv : null,
    tailoredHtml: plannedHtml ? paths.tailoredHtml : null,
    tailoredPdf: plannedPdf ? paths.tailoredPdf : null,
    changes: paths.changes,
    decision: paths.decision,
    interviewPrep: paths.interviewPrep,
    canonicalReport,
    canonicalJd,
    sourceHtml: htmlSource,
    sourcePdf: pdfSource,
    migrated: Boolean(values.migrate),
    dryRun: Boolean(values['dry-run']),
  };

  if (values['dry-run']) return resolved;

  // All inputs, destinations, ambiguity checks, and migration guards have
  // passed before the first mutation below.
  for (const directory of paths.directories) mkdirSync(directory, { recursive: true });
  const artifactSources = new Map();
  atomicCopy(canonicalReport, paths.report);
  artifactSources.set('report', canonicalReport);
  if (canonicalJd) {
    atomicCopy(canonicalJd, paths.jd);
    artifactSources.set('jd', canonicalJd);
  }
  if (sourceCv) {
    atomicCopyImmutableVersion(sourceCv, paths.sourceCv, 'source CV snapshot');
    artifactSources.set('source_cv', sourceCv);
  }
  if (htmlSource) {
    atomicCopyImmutableVersion(htmlSource, paths.tailoredHtml, 'tailored HTML');
    artifactSources.set('tailored_html', htmlSource);
  }
  if (pdfSource) {
    atomicCopyImmutableVersion(pdfSource, paths.tailoredPdf, 'tailored PDF');
    artifactSources.set('tailored_pdf', pdfSource);
  }
  if (coverSource) {
    atomicCopy(coverSource, paths.coverLetter);
    artifactSources.set('cover_letter', coverSource);
  } else if (extractedCover) {
    atomicWrite(paths.coverLetter, `${extractedCover.trim()}\n`);
    artifactSources.set('cover_letter', canonicalReport);
  }
  if (!existingChanges) {
    atomicWrite(paths.changes, `# Packaging notes\n\n- Created application package for report #${report}.\n- Canonical report and JD remain in their career-ops source directories.\n`);
  }
  const decision = ensureDecision(
    paths.decision,
    workspaceRoot,
    sourceCv || existingSourceCv,
    canonicalJd,
    false,
    existingDecision,
  );

  const artifactDestinations = {
    report: paths.report,
    jd: canonicalJd ? paths.jd : null,
    cover_letter: (coverSource || extractedCover || existsSync(paths.coverLetter)) ? paths.coverLetter : null,
    source_cv: (sourceCv || existingSourceCv) ? paths.sourceCv : null,
    tailored_html: (htmlSource || existsSync(paths.tailoredHtml)) ? paths.tailoredHtml : null,
    tailored_pdf: (pdfSource || existsSync(paths.tailoredPdf)) ? paths.tailoredPdf : null,
    changes: paths.changes,
    decision: paths.decision,
  };
  const artifacts = {};
  const provenance = {};
  for (const [key, destination] of Object.entries(artifactDestinations)) {
    artifacts[key] = destination ? repoRelative(destination, workspaceRoot, `artifact ${key}`) : null;
    if (destination) {
      const source = artifactSources.get(key) || null;
      provenance[key] = artifactProvenance(source, destination, workspaceRoot, source ? 'copied' : 'preserved');
    }
  }

  const application = {
    schema_version: 2,
    report_number: report,
    company,
    role,
    canonical_report: repoRelative(canonicalReport, workspaceRoot, 'canonical report'),
    canonical_jd: canonicalJd ? repoRelative(canonicalJd, workspaceRoot, 'canonical JD') : null,
    package_root: repoRelative(paths.root, workspaceRoot, 'package root'),
    cv_version: Number(version),
    artifacts,
    provenance,
    directories: {
      interview_prep: repoRelative(paths.interviewPrep, workspaceRoot, 'interview prep directory'),
    },
    decision: repoRelative(paths.decision, workspaceRoot, 'decision path'),
    updated_at: new Date().toISOString(),
  };
  if (existingApplication) {
    const { updated_at: ignoredPreviousTime, ...previousMaterial } = existingApplication;
    const { updated_at: ignoredCurrentTime, ...currentMaterial } = application;
    if (JSON.stringify(previousMaterial) === JSON.stringify(currentMaterial) && typeof existingApplication.updated_at === 'string') {
      application.updated_at = existingApplication.updated_at;
    }
  }
  writeJsonIfChanged(paths.manifest, application);

  const bothPackaged = existsSync(paths.tailoredHtml) && existsSync(paths.tailoredPdf);
  if (bothPackaged) {
    assertRegularFile(paths.tailoredHtml, 'packaged HTML');
    assertRegularFile(paths.tailoredPdf, 'packaged PDF');
  }
  if (bothPackaged) {
    withPdfIndexLock(workspaceRoot, () => {
      const lockedManifest = readPdfManifest(workspaceRoot, report);
      updatePdfManifest(
        workspaceRoot,
        lockedManifest,
        report,
        paths.tailoredHtml,
        paths.tailoredPdf,
        format || lockedManifest.row?.format,
        false,
      );
    });
  }

  if (values.migrate) {
    for (const source of [...new Set(migrationSources)]) {
      const destination = source === htmlSource ? paths.tailoredHtml : paths.tailoredPdf;
      if (!destination || !existsSync(destination)) throw fail(`migration destination was not created for ${source}`);
      const before = fileHash(source);
      const copied = fileHash(destination);
      if (before !== copied || fileHash(source) !== before) {
        throw fail(`refusing to remove ${source}: source and destination hashes do not match`);
      }
      assertMigrationSource(source, paths.outputRoot, 'legacy source');
      unlinkSync(source);
    }
  }

  return {
    ...resolved,
    application: paths.manifest,
    pdfIndex: bothPackaged ? manifest.path : null,
    decision,
  };
}

function main(argv = process.argv.slice(2)) {
  try {
    const values = parseOptions(argv);
    if (values.help) {
      console.log(usage());
      return;
    }
    if (!values.report || !values.company || !values.role) {
      throw fail(`${usage().trim()}`);
    }
    const result = runPackage(values);
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(error.message || String(error));
    process.exitCode = 1;
  }
}

if (
  process.argv[1]
  && realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url))
) {
  main();
}
