#!/usr/bin/env node

/**
 * Render cover-letter PDF and DOCX siblings.
 *
 * This is a user-layer companion to the system cover-letter renderer. It does
 * not alter the upstream generator. Payloads use the canonical cover-letter
 * template; existing Markdown drafts use a small deterministic Markdown
 * renderer before conversion to PDF/DOCX.
 *
 * Usage:
 *   node local-tools/cover-letter-variants.mjs --payload output/.../cover-letter.json
 *   node local-tools/cover-letter-variants.mjs --markdown output/.../cover-letter.md
 *   node local-tools/cover-letter-variants.mjs --all-existing
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { buildHtml, safeOutputPath } from '../generate-cover-letter.mjs';
import { renderBatch } from '../generate-pdf.mjs';
import { assertFacts, verifyFacts } from '../verify-cv-facts.mjs';

const ROOT = resolve(dirname(dirname(fileURLToPath(import.meta.url))));
const OUTPUT_ROOT = resolve(ROOT, 'output');
const TEXTUTIL = process.env.CAREER_OPS_TEXTUTIL || '/usr/bin/textutil';

function fail(message) {
  throw new Error(`cover-letter-variants: ${message}`);
}

function assertOutput(pathValue, label) {
  const abs = resolve(pathValue);
  const rel = relative(OUTPUT_ROOT, abs);
  if (!rel || rel.startsWith('..') || rel.includes('\\')) {
    fail(`${label} must remain inside output/: ${pathValue}`);
  }
  return abs;
}

function htmlEscape(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function inlineMarkdown(value) {
  let text = htmlEscape(value);
  text = text.replace(/\*\*([^*]+?)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/__([^_]+?)__/g, '<strong>$1</strong>');
  text = text.replace(/\*([^*]+?)\*/g, '<em>$1</em>');
  text = text.replace(/_([^_]+?)_/g, '<em>$1</em>');
  text = text.replace(/`([^`]+?)`/g, '<code>$1</code>');
  return text;
}

function markdownToHtml(markdown) {
  const lines = String(markdown ?? '').replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  let paragraph = [];
  let list = [];
  let quote = [];

  const flushParagraph = () => {
    if (!paragraph.length) return;
    blocks.push(`<p>${paragraph.map(inlineMarkdown).join(' ')}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (!list.length) return;
    blocks.push(`<ul>${list.map((item) => `<li>${inlineMarkdown(item)}</li>`).join('')}</ul>`);
    list = [];
  };
  const flushQuote = () => {
    if (!quote.length) return;
    blocks.push(`<blockquote>${quote.map(inlineMarkdown).join('<br>')}</blockquote>`);
    quote = [];
  };
  const flushAll = () => {
    flushParagraph();
    flushList();
    flushQuote();
  };

  for (const line of lines) {
    if (!line.trim()) {
      flushAll();
      continue;
    }
    if (/^\s*---+\s*$/.test(line)) {
      flushAll();
      blocks.push('<hr>');
      continue;
    }
    const quoteMatch = line.match(/^\s*>\s?(.*)$/);
    if (quoteMatch) {
      flushParagraph();
      flushList();
      quote.push(quoteMatch[1]);
      continue;
    }
    const listMatch = line.match(/^\s*[-*+]\s+(.*)$/);
    if (listMatch) {
      flushParagraph();
      flushQuote();
      list.push(listMatch[1]);
      continue;
    }
    const headingMatch = line.match(/^\s*(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      flushAll();
      const level = Math.min(headingMatch[1].length + 1, 6);
      blocks.push(`<h${level}>${inlineMarkdown(headingMatch[2])}</h${level}>`);
      continue;
    }
    const boldHeading = line.match(/^\s*\*\*([^*]+)\*\*(?:\s+\*([^*]+)\*)?\s*$/);
    if (boldHeading) {
      flushAll();
      const suffix = boldHeading[2] ? ` <em>${inlineMarkdown(boldHeading[2])}</em>` : '';
      blocks.push(`<h2>${inlineMarkdown(boldHeading[1])}${suffix}</h2>`);
      continue;
    }
    flushList();
    flushQuote();
    paragraph.push(line.trim());
  }
  flushAll();

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Cover Letter</title>
<style>
  @page { size: letter; margin: 0.6in; }
  * { box-sizing: border-box; font-variant-ligatures: none; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 10pt; line-height: 1.4; color: #1a1a1a; }
  p { margin: 0 0 8pt; }
  h2 { font-size: 11pt; margin: 11pt 0 4pt; color: #1A56A0; }
  h3, h4, h5, h6 { font-size: 10pt; margin: 9pt 0 3pt; color: #1A56A0; }
  ul { margin: 0 0 8pt 18pt; padding: 0; }
  li { margin: 0 0 5pt; padding-left: 2pt; }
  blockquote { margin: 0 0 8pt; padding-left: 10pt; border-left: 2pt solid #cccccc; color: #666666; }
  hr { border: 0; border-top: 0.5pt solid #cccccc; margin: 8pt 0; }
  code { font-family: Menlo, Consolas, monospace; font-size: 9pt; }
</style>
</head>
<body>${blocks.join('\n')}</body>
</html>`;
}

function walk(root) {
  const found = [];
  const visit = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const pathValue = join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) visit(pathValue);
      else if (entry.isFile() && entry.name === 'cover-letter.md') found.push(pathValue);
    }
  };
  visit(root);
  return found.sort();
}

function payloadArtifact(payloadPath) {
  const payload = JSON.parse(readFileSync(payloadPath, 'utf8'));
  const html = buildHtml(payload);
  const facts = assertFacts(html, { label: `cover letter ${payloadPath}` });
  if (facts.verdict === 'block') {
    fail(`fact gate blocked ${payloadPath}: ${facts.errors.join('; ')}`);
  }
  const pdfPath = safeOutputPath(payload.output_path);
  return { sourcePath: resolve(payloadPath), html, pdfPath, docxPath: pdfPath.replace(/\.pdf$/i, '.docx') };
}

function markdownArtifact(markdownPath) {
  const sourcePath = resolve(markdownPath);
  const html = markdownToHtml(readFileSync(sourcePath, 'utf8'));
  const facts = verifyFacts(html);
  if (facts.verdict === 'block') {
    const details = [
      ...facts.invented.map((value) => `metric=${value}`),
      ...facts.unsupportedFacts.map(({ kind, value }) => `${kind}=${value}`),
      ...facts.forbidden.map((value) => `forbidden=${value}`),
    ];
    console.warn(`⚠️ Existing Markdown fact check advisory for ${sourcePath}: ${details.join('; ')}`);
  }
  const stem = sourcePath.slice(0, -extname(sourcePath).length);
  return {
    sourcePath,
    html,
    pdfPath: assertOutput(`${stem}.pdf`, 'PDF output'),
    docxPath: assertOutput(`${stem}.docx`, 'DOCX output'),
  };
}

function writeDocx(artifact) {
  if (!existsSync(TEXTUTIL)) fail(`textutil not found at ${TEXTUTIL}`);
  mkdirSync(dirname(artifact.docxPath), { recursive: true });
  const tempHtml = join(tmpdir(), `career-ops-cover-${randomUUID()}.html`);
  try {
    writeFileSync(tempHtml, artifact.html, 'utf8');
    execFileSync(TEXTUTIL, ['-convert', 'docx', '-output', artifact.docxPath, tempHtml], { stdio: 'pipe' });
  } finally {
    try { unlinkSync(tempHtml); } catch { /* best effort */ }
  }
}

function collectArtifacts(values) {
  const artifacts = [];
  if (values['all-existing']) {
    for (const pathValue of walk(OUTPUT_ROOT)) artifacts.push(markdownArtifact(pathValue));
    const canonicalPayload = join(OUTPUT_ROOT, '_shared', 'canonical', 'cover-letter.json');
    if (existsSync(canonicalPayload)) artifacts.push(payloadArtifact(canonicalPayload));
  }
  if (values.markdown) artifacts.push(markdownArtifact(values.markdown));
  if (values.payload) artifacts.push(payloadArtifact(values.payload));
  const unique = new Map(artifacts.map((artifact) => [artifact.pdfPath, artifact]));
  if (!unique.size) fail('provide --markdown, --payload, or --all-existing');
  return [...unique.values()];
}

const { values } = parseArgs({
  options: {
    markdown: { type: 'string' },
    payload: { type: 'string' },
    'all-existing': { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
  },
  strict: true,
});

if (values.help) {
  console.log('Usage: node local-tools/cover-letter-variants.mjs --markdown PATH | --payload PATH | --all-existing');
  process.exit(0);
}

try {
  const artifacts = collectArtifacts(values);
  for (const artifact of artifacts) writeDocx(artifact);
  const results = await renderBatch(artifacts.map((artifact) => ({
    html: artifact.html,
    outputPath: artifact.pdfPath,
    format: 'letter',
    inputPath: artifact.sourcePath,
    maxPages: 2,
  })));
  const failures = results.filter((result) => !result.ok);
  if (failures.length) {
    for (const failure of failures) console.error(`PDF failed: ${failure.outputPath}: ${failure.error}`);
    process.exitCode = 1;
  }
  for (const [index, artifact] of artifacts.entries()) {
    const result = results[index];
    if (result?.ok) console.log(`✅ ${artifact.pdfPath} (${result.pageCount} page(s)) + ${artifact.docxPath}`);
    else console.log(`⚠️  ${artifact.docxPath} created; PDF failed`);
  }
} catch (error) {
  console.error(`❌ ${error.message}`);
  process.exitCode = 1;
}
