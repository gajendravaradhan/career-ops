// Tests for the analytics headline tiles' cumulative counters.
// Imports directly from funnel-tiles.mjs (the single source of truth) so the
// test and production code can never drift out of sync.
//
// Run:  node --test tests/lib/funnel-tiles.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { cumulativeTiles, cumulativeTilesWithHistory } from "../../src/lib/funnel-tiles.mjs";

test("an offer-holder has already interviewed", () => {
  // The bug: a snapshot count reported interviews=0 here, so the tile showed
  // the "Interviews follow replies — keep follow-ups warm" nudge to someone
  // holding an offer.
  const t = cumulativeTiles(["OFFER"]);
  assert.equal(t.interviews, 1);
  assert.equal(t.offers, 1);
});

test("a hire counts as both an interview and an offer", () => {
  // Landing the job proves the offer and everything before it (stats.mjs
  // computeFunnel: everOffer = Offer + Hired). Previously BOTH tiles read 0
  // and BOTH nudges fired at a candidate who had just been hired.
  const t = cumulativeTiles(["HIRED"]);
  assert.equal(t.interviews, 1);
  assert.equal(t.offers, 1);
});

test("stages accumulate across a realistic pipeline", () => {
  const t = cumulativeTiles(["HIRED", "OFFER", "INTERVIEW", "APPLIED", "APPLIED", "EVALUATED"]);
  assert.equal(t.interviews, 3); // interview + offer + hired
  assert.equal(t.offers, 2); // offer + hired
});

test("stages that never reached an interview are not counted", () => {
  const t = cumulativeTiles(["EVALUATED", "APPLIED", "RESPONDED", "DISCARDED", "SKIP"]);
  assert.equal(t.interviews, 0);
  assert.equal(t.offers, 0);
});

test("a rejection alone does not claim an interview", () => {
  // Rejected proves Responded, but this surface only shows Interview/Offer.
  const t = cumulativeTiles(["REJECTED", "REJECTED"]);
  assert.equal(t.interviews, 0);
  assert.equal(t.offers, 0);
});

test("ledger history preserves interview and offer achievements after terminal statuses", () => {
  const apps = [
    { n: "1", status: "REJECTED" },
    { n: "2", status: "DISCARDED" },
    { n: "3", status: "REJECTED" },
  ];
  const ledger = [
    "1\t2026-08-01\tINTERVIEW\tREJECTED\tset-status\t",
    "2\t2026-08-02\tOFFER\tDISCARDED\tset-status\t",
    "junk\t2026-08-03\tOFFER\tHIRED\tset-status\t",
    "99\t2026-08-03\tOFFER\tHIRED\tset-status\tremoved row",
  ].join("\n");
  assert.deepEqual(cumulativeTilesWithHistory(apps, ledger), { interviews: 2, offers: 1 });
});

test("an empty or absent pipeline is zero, not a crash", () => {
  assert.deepEqual(cumulativeTiles([]), { interviews: 0, offers: 0 });
  assert.deepEqual(cumulativeTiles(undefined), { interviews: 0, offers: 0 });
});
