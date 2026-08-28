// Cumulative "how far has this search actually got?" counters for the analytics
// headline tiles. Pure JS (no TS types) so it can be imported by the analytics
// page and unit-tested under `node --test`, matching clean-chips.mjs /
// stream-parse.mjs / act-envelope.mjs.
//
// The "Pipeline by stage" BARS below the tiles are deliberately a current-state
// snapshot — Hired, Rejected and Discarded are each their own bar, and an
// application sits in exactly one. The two headline tiles are a different
// question: they are achievement counters ("interviews", "offers") whose
// zero-state shows a coaching nudge. Reading a snapshot count there means a
// candidate who ADVANCED past a stage reads zero for it and gets told to try
// harder to reach the stage they already cleared.
//
// The cumulative math is the core's, not a new invention: computeFunnel() in
// stats.mjs is the canonical definition —
//   everInterview = Interview + Offer + Hired
//   everOffer     = Offer + Hired
// — on the reasoning that a landed job proves the offer and everything before
// it. Rejected proves a response but not an interview from the snapshot alone;
// status-log.tsv supplies the missing historical depth when available.

/**
 * Count applications whose canonical status is any of `keys`.
 *
 * @param {string[]} canonStatuses - Already-canonicalized (uppercase) statuses.
 * @param {string[]} keys - Canonical stage keys to count.
 * @returns {number}
 */
function countOf(canonStatuses, keys) {
  return canonStatuses.filter((s) => keys.some((k) => s.includes(k))).length;
}

/**
 * Cumulative interview/offer counters for the analytics headline tiles.
 *
 * @param {string[]} canonStatuses - Canonicalized statuses, one per application.
 * @returns {{interviews: number, offers: number}}
 */
export function cumulativeTiles(canonStatuses) {
  const list = Array.isArray(canonStatuses) ? canonStatuses : [];
  return {
    interviews: countOf(list, ["INTERVIEW", "OFFER", "HIRED"]),
    offers: countOf(list, ["OFFER", "HIRED"]),
  };
}

function stageRank(status) {
  const value = String(status ?? "").toUpperCase();
  if (value.includes("HIRED")) return 5;
  if (value.includes("OFFER")) return 4;
  if (value.includes("INTERVIEW")) return 3;
  if (value.includes("RESPONDED") || value.includes("REJECTED")) return 2;
  if (value.includes("APPLIED")) return 1;
  return 0;
}

/** Ledger-aware headline counters, one maximum stage per live tracker row. */
export function cumulativeTilesWithHistory(applications, statusLogText) {
  const rows = Array.isArray(applications) ? applications : [];
  const live = new Set();
  const ranks = new Map();
  for (const app of rows) {
    const raw = String(app?.n ?? "").trim();
    if (!/^\d+$/.test(raw)) continue;
    const num = Number(raw);
    live.add(num);
    ranks.set(num, Math.max(ranks.get(num) ?? 0, stageRank(app?.status)));
  }

  for (const line of String(statusLogText ?? "").replace(/\r/g, "").split("\n")) {
    const cols = line.split("\t");
    if (cols.length < 4 || !/^\d+$/.test(cols[0]?.trim() ?? "") || !cols[1]?.trim() || !cols[2]?.trim() || !cols[3]?.trim()) continue;
    const num = Number(cols[0].trim());
    if (!live.has(num)) continue;
    ranks.set(num, Math.max(ranks.get(num) ?? 0, stageRank(cols[2]), stageRank(cols[3])));
  }

  let interviews = 0;
  let offers = 0;
  for (const rank of ranks.values()) {
    if (rank >= 3) interviews++;
    if (rank >= 4) offers++;
  }
  return { interviews, offers };
}
