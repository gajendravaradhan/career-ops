/** Return the report number referenced by a tracker report cell. */
export function reportNumberFromCell(cell) {
  const value = String(cell ?? "");
  const markdown = value.match(/\[(\d+)\]\([^)]+\)/);
  const filename = value.match(/(?:^|[/\\])(\d+)-[^/\\]+\.md(?:$|[?#])/i);
  const raw = markdown?.[1] ?? filename?.[1];
  return raw ? Number.parseInt(raw, 10) : null;
}

/** Resolve the exact PDF path recorded for a report in pdf-index.tsv. */
export function pdfPathForReport(indexText, reportNumber) {
  if (!Number.isSafeInteger(reportNumber) || reportNumber <= 0) return null;
  for (const line of String(indexText ?? "").split(/\r?\n/)) {
    if (!line.trim() || line.startsWith("#")) continue;
    const columns = line.split("\t");
    const raw = columns[0]?.trim() ?? "";
    if (!/^\d+$/.test(raw) || Number.parseInt(raw, 10) !== reportNumber) continue;
    const pdf = columns[1]?.trim();
    return pdf || null;
  }
  return null;
}
