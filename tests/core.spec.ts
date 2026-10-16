// Core estimator tests: `node --test tests/core.spec.ts` (Node >= 22.18).
//
// fixtures/golden.json holds the golden values, so these pin the estimator's
// numbers.
// (Named .spec.ts so `claude plugin test` leaves it to Node.)

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { parseTranscript, totalsFromApiUsage } from "../core/transcript.ts";
import {
  addTotals,
  classifyModel,
  describeEquivalent,
  emptyTotals,
  estimateRange,
  estimateUsage,
  estimateUsageRange,
  estimateWater,
  fmtWater,
  parseRegion,
  type TokenTotals,
} from "../core/water.ts";

type Golden = {
  classes: { model: string | null; cls: string }[];
  cases: {
    totals: TokenTotals;
    model: string | null;
    region: string;
    onsite: number;
    offsite: number;
    total: number;
  }[];
  ranges: { totals: TokenTotals; model: string | null; min: number; max: number }[];
  fmt: { ml: number; text: string }[];
  equiv: { ml: number; text: string }[];
  transcript: { text: string; model: string; totals: TokenTotals };
};

const golden = JSON.parse(
  readFileSync(new URL("fixtures/golden.json", import.meta.url), "utf8"),
) as Golden;

function close(actual: number, expected: number): void {
  assert.ok(Math.abs(actual - expected) <= 1e-9 * Math.max(1, Math.abs(expected)), `${actual} != ${expected}`);
}

test("classifies models into the golden classes", () => {
  for (const { model, cls } of golden.classes) assert.equal(classifyModel(model ?? undefined), cls);
});

test("estimates match the golden values", () => {
  for (const c of golden.cases) {
    const got = estimateWater(c.totals, c.model ?? undefined, c.region);
    close(got.onsiteMl, c.onsite);
    close(got.offsiteMl, c.offsite);
    close(got.totalMl, c.total);
  }
  for (const r of golden.ranges) {
    const got = estimateRange(r.totals, r.model ?? undefined);
    close(got.minMl, r.min);
    close(got.maxMl, r.max);
  }
});

test("formats and equivalents match the golden values", () => {
  for (const { ml, text } of golden.fmt) assert.equal(fmtWater(ml), text);
  for (const { ml, text } of golden.equiv) assert.equal(describeEquivalent(ml), text);
});

test("transcript usage is deduplicated by message id and split by model", () => {
  const byModel = parseTranscript(golden.transcript.text);
  const sum = Object.values(byModel).reduce(addTotals, emptyTotals());
  assert.deepEqual(sum, golden.transcript.totals);
  assert.deepEqual(Object.keys(byModel).sort(), ["claude-opus-5-5", "claude-sonnet-4-5"]);
  assert.equal(byModel["claude-sonnet-4-5"]?.output, 60);
});

test("each model is charged its own energy", () => {
  const opus = { ...emptyTotals(), input: 1000, output: 1000 };
  const haiku = { ...emptyTotals(), input: 5000, output: 5000 };
  const mixed = estimateUsage({ "claude-opus-5-5": opus, "claude-haiku-4-5": haiku }, "us");
  const separate =
    estimateWater(opus, "claude-opus-5-5", "us").totalMl +
    estimateWater(haiku, "claude-haiku-4-5", "us").totalMl;
  close(mixed.totalMl, separate);
  const range = estimateUsageRange({ "claude-opus-5-5": opus });
  close(range.maxMl, estimateWater(opus, "claude-opus-5-5", "us").totalMl);
  close(range.minMl, estimateWater(opus, "claude-opus-5-5", "renewable").totalMl);
});

test("API usage and region names parse defensively", () => {
  assert.deepEqual(
    totalsFromApiUsage({ input_tokens: 5, output_tokens: -1, cache_read_input_tokens: "x", cache_creation_input_tokens: 2 }),
    { input: 5, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 2 },
  );
  assert.deepEqual(totalsFromApiUsage(null), emptyTotals());
  assert.equal(parseRegion(" Asia\n"), "asia");
  assert.equal(parseRegion("mars"), null);
  assert.equal(parseRegion(undefined), null);
});
