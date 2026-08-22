import assert from 'node:assert/strict';
import test from 'node:test';
import { copyFile, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFile as execFileCallback } from 'node:child_process';
import { tmpdir } from 'node:os';
import { basename, isAbsolute, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

import {
  isPathInside,
  runPackage,
  safeCompanyDirectory,
} from './application-package.mjs';

const PDF_INDEX_HEADER = '# report\tpdf\thtml\tformat\tdate — written by generate-pdf.mjs, do not edit\n';
const execFile = promisify(execFileCallback);
const PACKAGER_PATH = fileURLToPath(new URL('./application-package.mjs', import.meta.url));

async function withWorkspace(t, callback) {
  const root = await mkdtemp(join(tmpdir(), 'career-ops-application-package-'));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });
  await mkdir(join(root, 'reports'), { recursive: true });
  await mkdir(join(root, 'jds'), { recursive: true });
  await mkdir(join(root, 'data'), { recursive: true });
  await mkdir(join(root, 'output'), { recursive: true });
  return callback(root);
}

async function write(root, file, content = file) {
  const target = join(root, file);
  await mkdir(join(target, '..'), { recursive: true });
  await writeFile(target, content);
  return target;
}

async function fixture(root, { report = '012', reportSuffix = 'equifax', jdSuffix = 'equifax' } = {}) {
  const normalizedReport = String(report).padStart(3, '0');
  const reportFile = await write(root, `reports/${normalizedReport}-${reportSuffix}-2026-08-22.md`, '# Evaluation\n');
  const jdFile = await write(root, `jds/${normalizedReport}-${jdSuffix}-role.md`, '# Job description\n');
  const sourceCv = await write(root, 'cv.md', '# Canonical CV\nVersion one\n');
  return { reportFile, jdFile, sourceCv, report: normalizedReport };
}

function options(overrides = {}) {
  return {
    report: '012',
    company: 'Equifax',
    role: 'Sr Director - AI Platform Engineering - D&A',
    version: 1,
    ...overrides,
  };
}

function run(optionsValue, root) {
  // Supports either a synchronous or asynchronous implementation while keeping
  // all rejection assertions on the public API.
  return Promise.resolve().then(() => runPackage(optionsValue, { root }));
}

async function packageManifest(root) {
  const files = await filesBelow(join(root, 'output'));
  const manifests = files.filter((file) => basename(file) === 'application.json');
  assert.equal(manifests.length, 1, `expected one application.json, got: ${manifests.join(', ')}`);
  return {
    path: manifests[0],
    value: JSON.parse(await readFile(manifests[0], 'utf8')),
  };
}

async function filesBelow(directory) {
  if (!existsSync(directory)) return [];
  const { readdir } = await import('node:fs/promises');
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const target = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await filesBelow(target));
    else if (entry.isFile()) files.push(target);
  }
  return files;
}

async function manifestRows(root) {
  const index = join(root, 'data', 'pdf-index.tsv');
  if (!existsSync(index)) return [];
  return (await readFile(index, 'utf8'))
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => line.split('\t'));
}

function assertWorkspaceRelative(value, root) {
  assert.equal(typeof value, 'string');
  assert.ok(value.length > 0);
  assert.equal(isAbsolute(value), false, `expected workspace-relative path, got ${value}`);
  assert.equal(value.split(/[\\/]/).includes('..'), false, `expected no parent traversal, got ${value}`);
  assert.equal(isPathInside(root, resolve(root, value)), true, `expected ${value} inside workspace`);
}

test('safeCompanyDirectory preserves normal human-readable company names', () => {
  assert.equal(safeCompanyDirectory('PwC'), 'PwC');
  assert.equal(safeCompanyDirectory('Ernst & Young'), 'Ernst & Young');
  assert.equal(safeCompanyDirectory('The Home Depot, Inc.'), 'The Home Depot, Inc.');
});

test('safeCompanyDirectory rejects traversal, absolute, and reserved company inputs', () => {
  for (const value of [
    '', '.', '..', '../escape', '../../escape', '/tmp/escape',
    'Acme/../../escape', 'Acme\\..\\escape', 'CON', 'NUL', 'aux', 'LPT1',
  ]) {
    assert.throws(() => safeCompanyDirectory(value), /company|safe|path|reserved|invalid/i, value);
  }
});

test('isPathInside rejects sibling-prefix and parent traversal paths', async (t) => {
  await withWorkspace(t, async (root) => {
    const output = join(root, 'output');
    assert.equal(isPathInside(output, join(output, 'Equifax', '012-role')), true);
    assert.equal(isPathInside(output, `${output}-other`), false, 'prefixes are not descendants');
    assert.equal(isPathInside(output, resolve(output, '..', 'escape')), false);
  });
});

test('traversal and reserved company inputs cannot escape output', async (t) => {
  await withWorkspace(t, async (root) => {
    await fixture(root);
    const escaped = resolve(root, '..', 'escape');
    await assert.rejects(run(options({ company: '../../escape' }), root), /company|safe|path|escape|invalid/i);
    assert.equal(existsSync(escaped), false, 'a rejected company name must not create a sibling directory');
    await assert.rejects(run(options({ company: 'CON' }), root), /company|reserved|invalid/i);
    assert.deepEqual(await filesBelow(join(root, 'output')), []);
  });
});

test('package destinations and manifest entries are workspace-relative and contained', async (t) => {
  await withWorkspace(t, async (root) => {
    const { sourceCv } = await fixture(root);
    const html = await write(root, 'inputs/cv.html', '<html>CV</html>');
    const pdf = await write(root, 'inputs/cv.pdf', '%PDF-1.7');

    await run(options({ sourceCv, cvHtml: html, cvPdf: pdf, format: 'letter' }), root);
    const { path, value } = await packageManifest(root);
    assert.equal(isPathInside(join(root, 'output'), path), true);
    assertWorkspaceRelative(value.package_root, root);
    assert.equal(value.package_root.startsWith('output/'), true);
    assertWorkspaceRelative(value.canonical_report, root);
    assertWorkspaceRelative(value.canonical_jd, root);
    for (const artifact of Object.values(value.artifacts)) {
      if (artifact !== null) assertWorkspaceRelative(artifact, root);
    }

    const [row] = await manifestRows(root);
    assert.deepEqual(row.slice(0, 3), ['012', value.artifacts.tailored_pdf, value.artifacts.tailored_html]);
  });
});

test('dry-run produces no package files or PDF-index mutation', async (t) => {
  await withWorkspace(t, async (root) => {
    const { sourceCv } = await fixture(root);
    const html = await write(root, 'inputs/cv.html', '<html>CV</html>');
    const pdf = await write(root, 'inputs/cv.pdf', '%PDF-1.7');

    await run(options({ sourceCv, cvHtml: html, cvPdf: pdf, format: 'letter', dryRun: true }), root);
    assert.deepEqual(await filesBelow(join(root, 'output')), []);
    assert.equal(existsSync(join(root, 'data', 'pdf-index.tsv')), false);
  });
});

test('explicit file flags reject blank paths instead of silently falling back', async (t) => {
  await withWorkspace(t, async (root) => {
    await fixture(root);
    for (const override of [
      { sourceCv: '   ' },
      { jd: '' },
      { cvHtml: ' ' },
      { cvPdf: '' },
      { coverLetter: '   ' },
    ]) {
      await assert.rejects(run(options(override), root), /non-empty file path/i);
    }
    assert.deepEqual(await filesBelow(join(root, 'output')), []);
  });
});

test('a new HTML/PDF manifest mapping requires an explicit paper format', async (t) => {
  await withWorkspace(t, async (root) => {
    const { sourceCv } = await fixture(root);
    const html = await write(root, 'inputs/cv.html', '<html>CV</html>');
    const pdf = await write(root, 'inputs/cv.pdf', '%PDF-1.7');

    await assert.rejects(
      run(options({ sourceCv, cvHtml: html, cvPdf: pdf }), root),
      /format|letter|a4/i,
    );
    assert.equal(existsSync(join(root, 'data', 'pdf-index.tsv')), false);
    assert.deepEqual(await filesBelow(join(root, 'output')), [], 'format preflight must fail before creating a partial package');
  });
});

test('migrate rejects external and nested legacy sources without removing them', async (t) => {
  await withWorkspace(t, async (root) => {
    const { sourceCv } = await fixture(root);
    const externalRoot = await mkdtemp(join(tmpdir(), 'career-ops-package-external-'));
    t.after(async () => rm(externalRoot, { recursive: true, force: true }));
    const externalHtml = join(externalRoot, 'legacy.html');
    const externalPdf = join(externalRoot, 'legacy.pdf');
    await writeFile(externalHtml, '<html>external</html>');
    await writeFile(externalPdf, '%PDF-external');

    await assert.rejects(
      run(options({ sourceCv, cvHtml: externalHtml, cvPdf: externalPdf, format: 'letter', migrate: true }), root),
      /migrate|legacy|output|direct|inside/i,
    );
    assert.equal(existsSync(externalHtml), true);
    assert.equal(existsSync(externalPdf), true);

    const nestedHtml = await write(root, 'output/Other/legacy.html', '<html>nested</html>');
    const nestedPdf = await write(root, 'output/Other/legacy.pdf', '%PDF-nested');
    await assert.rejects(
      run(options({ sourceCv, cvHtml: nestedHtml, cvPdf: nestedPdf, format: 'letter', migrate: true }), root),
      /migrate|legacy|output|direct|inside/i,
    );
    assert.equal(existsSync(nestedHtml), true);
    assert.equal(existsSync(nestedPdf), true);
  });
});

test('migrate removes a direct-child legacy HTML/PDF pair only after successful copy and manifest publication', async (t) => {
  await withWorkspace(t, async (root) => {
    const { sourceCv } = await fixture(root);
    const legacyHtml = await write(root, 'output/legacy-cv.html', '<html>legacy</html>');
    const legacyPdf = await write(root, 'output/legacy-cv.pdf', '%PDF-legacy');

    await run(options({ sourceCv, cvHtml: legacyHtml, cvPdf: legacyPdf, format: 'letter', migrate: true }), root);
    const { value } = await packageManifest(root);
    assert.equal(existsSync(legacyHtml), false);
    assert.equal(existsSync(legacyPdf), false);
    assert.equal(await readFile(join(root, value.artifacts.tailored_html), 'utf8'), '<html>legacy</html>');
    assert.equal(await readFile(join(root, value.artifacts.tailored_pdf), 'utf8'), '%PDF-legacy');
    assert.equal((await manifestRows(root)).length, 1);
  });
});

test('a manifest failure retains legacy migration sources', async (t) => {
  await withWorkspace(t, async (root) => {
    const { sourceCv } = await fixture(root);
    const legacyHtml = await write(root, 'output/legacy-cv.html', '<html>legacy</html>');
    const legacyPdf = await write(root, 'output/legacy-cv.pdf', '%PDF-legacy');
    // A directory at the published index path makes its read/atomic replacement
    // fail through the public API after sources have been selected for migration.
    await mkdir(join(root, 'data', 'pdf-index.tsv'));

    await assert.rejects(
      run(options({ sourceCv, cvHtml: legacyHtml, cvPdf: legacyPdf, format: 'letter', migrate: true }), root),
      /pdf-index|manifest|directory|EISDIR/i,
    );
    assert.equal(existsSync(legacyHtml), true);
    assert.equal(existsSync(legacyPdf), true);
  });
});

test('PDF-index preserves A4 or letter format and deduplicates padded and unpadded report IDs', async (t) => {
  for (const format of ['a4', 'letter']) {
    await withWorkspace(t, async (root) => {
      const { sourceCv } = await fixture(root);
      const legacyHtml = await write(root, 'output/legacy-cv.html', '<html>legacy</html>');
      const legacyPdf = await write(root, 'output/legacy-cv.pdf', '%PDF-legacy');
      await write(root, 'data/pdf-index.tsv', `${PDF_INDEX_HEADER}12\toutput/legacy-cv.pdf\toutput/legacy-cv.html\t${format}\t2026-01-01\n`);

      await run(options({ sourceCv, cvHtml: legacyHtml, cvPdf: legacyPdf }), root);
      await run(options({ report: '12', sourceCv, cvHtml: legacyHtml, cvPdf: legacyPdf }), root);

      const rows = await manifestRows(root);
      assert.equal(rows.length, 1);
      assert.equal(rows[0][0], '012');
      assert.equal(rows[0][3], format);
      assertWorkspaceRelative(rows[0][1], root);
      assertWorkspaceRelative(rows[0][2], root);
    });
  }
});

test('the source-CV snapshot is not silently overwritten after canonical CV changes', async (t) => {
  await withWorkspace(t, async (root) => {
    const { sourceCv } = await fixture(root);
    await run(options({ sourceCv }), root);
    const first = await packageManifest(root);
    const snapshot = join(root, first.value.artifacts.source_cv);
    assert.equal(await readFile(snapshot, 'utf8'), '# Canonical CV\nVersion one\n');

    await writeFile(sourceCv, '# Canonical CV\nVersion two\n');
    await assert.rejects(run(options({ sourceCv }), root), /source.*CV|snapshot|version|differ/i);
    assert.equal(await readFile(snapshot, 'utf8'), '# Canonical CV\nVersion one\n');

    await run(options({ sourceCv, version: 2 }), root);
    const second = await packageManifest(root);
    assert.match(second.value.artifacts.source_cv, /cv\/source\/v002\/cv\.md$/);
    assert.equal(await readFile(join(root, second.value.artifacts.source_cv), 'utf8'), '# Canonical CV\nVersion two\n');
    assert.equal(await readFile(snapshot, 'utf8'), '# Canonical CV\nVersion one\n');
  });
});

test('an existing tailored version is immutable when new artifact bytes differ', async (t) => {
  await withWorkspace(t, async (root) => {
    const { reportFile, sourceCv } = await fixture(root);
    const html = await write(root, 'inputs/cv.html', '<html>version one</html>');
    const pdf = await write(root, 'inputs/cv.pdf', '%PDF-version-one');
    const input = options({ sourceCv, cvHtml: html, cvPdf: pdf, format: 'letter' });
    await run(input, root);
    const { value } = await packageManifest(root);
    const tailoredHtml = join(root, value.artifacts.tailored_html);
    const tailoredPdf = join(root, value.artifacts.tailored_pdf);
    const packagedReport = join(root, value.artifacts.report);

    await writeFile(html, '<html>version two</html>');
    await writeFile(pdf, '%PDF-version-two');
    await writeFile(reportFile, '# Evaluation changed after v001\n');
    await assert.rejects(run(input, root), /tailored|version|exists|differ|overwrite/i);
    assert.equal(await readFile(tailoredHtml, 'utf8'), '<html>version one</html>');
    assert.equal(await readFile(tailoredPdf, 'utf8'), '%PDF-version-one');
    assert.equal(await readFile(packagedReport, 'utf8'), '# Evaluation\n', 'preflight failure must not partially refresh the report snapshot');
  });
});

test('symlinked sources and an output symlink escape are rejected', async (t) => {
  if (process.platform === 'win32') t.skip('creating symlinks requires additional Windows privileges');
  await withWorkspace(t, async (root) => {
    const { sourceCv } = await fixture(root);
    const realHtml = await write(root, 'inputs/real.html', '<html>real</html>');
    const linkedHtml = join(root, 'inputs', 'linked.html');
    await symlink(realHtml, linkedHtml);
    await assert.rejects(
      run(options({ sourceCv, cvHtml: linkedHtml }), root),
      /symlink|regular|source|unsafe/i,
    );

    const external = await mkdtemp(join(tmpdir(), 'career-ops-output-escape-'));
    t.after(async () => rm(external, { recursive: true, force: true }));
    await rm(join(root, 'output'), { recursive: true, force: true });
    await symlink(external, join(root, 'output'), 'dir');
    await assert.rejects(run(options({ sourceCv }), root), /symlink|output|contain|escape|unsafe/i);
    assert.deepEqual(await filesBelow(external), []);
  });
});

test('rerunning unchanged input leaves application.json byte-identical', async (t) => {
  await withWorkspace(t, async (root) => {
    const { sourceCv } = await fixture(root);
    const input = options({ sourceCv });
    await run(input, root);
    const first = await packageManifest(root);
    const before = await readFile(first.path, 'utf8');
    await run(input, root);
    const second = await packageManifest(root);
    assert.equal(await readFile(second.path, 'utf8'), before);
  });
});

test('ambiguous canonical reports and JDs fail closed', async (t) => {
  await withWorkspace(t, async (root) => {
    const { sourceCv } = await fixture(root);
    await write(root, 'reports/012-second-report-2026-08-22.md', '# Ambiguous report\n');
    await assert.rejects(run(options({ sourceCv }), root), /ambiguous.*report|report.*ambiguous/i);

    await rm(join(root, 'reports', '012-second-report-2026-08-22.md'));
    await write(root, 'jds/012-second-jd.md', '# Ambiguous JD\n');
    await assert.rejects(run(options({ sourceCv }), root), /ambiguous.*jd|jd.*ambiguous/i);
  });
});

test('missing cover letter, HTML, and PDF are represented honestly without fabricated files', async (t) => {
  await withWorkspace(t, async (root) => {
    const { sourceCv } = await fixture(root);
    await run(options({ sourceCv }), root);
    const { value } = await packageManifest(root);
    assert.equal(value.artifacts.cover_letter, null);
    assert.equal(value.artifacts.tailored_html, null);
    assert.equal(value.artifacts.tailored_pdf, null);

    const packageRoot = join(root, value.package_root);
    assert.equal(existsSync(join(packageRoot, 'cover-letter', 'cover-letter.md')), false);
    assert.equal(existsSync(join(packageRoot, 'cv', 'tailored', 'v001', 'cv.html')), false);
    assert.equal(existsSync(join(packageRoot, 'cv', 'tailored', 'v001', 'cv.pdf')), false);
    assert.equal(existsSync(join(packageRoot, 'interview-prep')), true);
  });
});

test('--migrate requires an explicit direct-child legacy artifact', async (t) => {
  await withWorkspace(t, async (root) => {
    const { sourceCv } = await fixture(root);
    await assert.rejects(run(options({ sourceCv, migrate: true }), root), /migrate.*explicit|cv-html|cv-pdf/i);
    assert.deepEqual(await filesBelow(join(root, 'output')), []);
  });
});

test('an explicit paper format overrides a stale prior manifest format', async (t) => {
  await withWorkspace(t, async (root) => {
    const { sourceCv } = await fixture(root);
    const html = await write(root, 'output/legacy-cv.html', '<html>legacy</html>');
    const pdf = await write(root, 'output/legacy-cv.pdf', '%PDF-legacy');
    await write(root, 'data/pdf-index.tsv', `${PDF_INDEX_HEADER}12\toutput/legacy-cv.pdf\toutput/legacy-cv.html\ta4\t2026-01-01\n`);

    await run(options({ sourceCv, cvHtml: html, cvPdf: pdf, format: 'letter' }), root);
    const [row] = await manifestRows(root);
    assert.equal(row[3], 'letter');
  });
});

test('rerunning one package replaces its PDF-index row in place without reordering unrelated reports', async (t) => {
  await withWorkspace(t, async (root) => {
    const { sourceCv } = await fixture(root);
    const html = await write(root, 'output/legacy-cv.html', '<html>legacy</html>');
    const pdf = await write(root, 'output/legacy-cv.pdf', '%PDF-legacy');
    await write(
      root,
      'data/pdf-index.tsv',
      `${PDF_INDEX_HEADER}011\toutput/eleven.pdf\toutput/eleven.html\tletter\t2026-01-01\n12\toutput/legacy-cv.pdf\toutput/legacy-cv.html\tletter\t2026-01-02\n013\toutput/thirteen.pdf\toutput/thirteen.html\ta4\t2026-01-03\n`,
    );

    await run(options({ sourceCv, cvHtml: html, cvPdf: pdf }), root);
    const first = await readFile(join(root, 'data', 'pdf-index.tsv'), 'utf8');
    await run(options({ sourceCv }), root);
    const second = await readFile(join(root, 'data', 'pdf-index.tsv'), 'utf8');
    assert.equal(second, first);
    assert.deepEqual((await manifestRows(root)).map((row) => row[0]), ['011', '012', '013']);
  });
});

test('parallel packagers preserve every PDF-index row', async (t) => {
  await withWorkspace(t, async (root) => {
    await write(root, 'cv.md', '# Canonical CV\n');
    const copiedTool = await write(root, 'local-tools/.keep', '');
    await rm(copiedTool);
    const toolPath = join(root, 'local-tools', 'application-package.mjs');
    await copyFile(PACKAGER_PATH, toolPath);

    const commands = [];
    for (let index = 21; index <= 28; index += 1) {
      const report = String(index).padStart(3, '0');
      await write(root, `reports/${report}-company-${index}.md`, '# Evaluation\n');
      await write(root, `jds/${report}-company-${index}.md`, '# JD\n');
      const html = await write(root, `inputs/${report}.html`, `<html>${report}</html>`);
      const pdf = await write(root, `inputs/${report}.pdf`, `%PDF-${report}`);
      commands.push(execFile(process.execPath, [
        toolPath,
        '--report', report,
        '--company', `Company ${index}`,
        '--role', `Director ${index}`,
        '--cv-html', html,
        '--cv-pdf', pdf,
        '--format', 'letter',
      ], { cwd: root }));
    }
    const results = await Promise.all(commands);

    const rows = await manifestRows(root);
    assert.deepEqual(
      rows.map((row) => row[0]).sort(),
      ['021', '022', '023', '024', '025', '026', '027', '028'],
      `child output: ${JSON.stringify(results)}`,
    );
  });
});
