// Token usage from a Claude Code JSONL transcript (one JSON object per line):
//
//   {"type":"assistant","message":{"id":"msg_...","model":"claude-...","usage":{
//     "input_tokens":N,"output_tokens":N,
//     "cache_read_input_tokens":N,"cache_creation_input_tokens":N}}}
//
// Claude Code writes one line per content block (text, thinking, tool_use), and
// every line of one API response repeats its `message.id` and `usage`, so usage
// is deduplicated by id (last line wins); a line without an id counts alone.
// Anthropic folds thinking tokens into `output_tokens`: `reasoning` stays 0.
//
// Caveat (upstream): `output_tokens` is a mid-stream snapshot there, so output
// read back from a transcript runs slightly low. Only the band's backfill of a
// session it joined late reads transcripts; live turns report exact counts.

import { addTotals, emptyTotals, type TokenTotals, type UsageByModel } from "./water.ts";

type Entry = { model: string; totals: TokenTotals };

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

/** Usage in the Anthropic API's spelling, as transcripts and turn events carry it. */
export function totalsFromApiUsage(value: unknown): TokenTotals {
  const usage = record(value);
  if (usage === null) return emptyTotals();
  return {
    input: count(usage.input_tokens),
    output: count(usage.output_tokens),
    reasoning: 0,
    cacheRead: count(usage.cache_read_input_tokens),
    cacheWrite: count(usage.cache_creation_input_tokens),
  };
}

function parseLine(line: string): { id: string | null; entry: Entry } | null {
  const trimmed = line.trim();
  if (trimmed === "") return null;
  let obj: Record<string, unknown> | null;
  try {
    obj = record(JSON.parse(trimmed));
  } catch {
    return null;
  }
  if (obj === null || obj.type !== "assistant") return null;
  const message = record(obj.message);
  if (message === null) return null;
  const id = typeof message.id === "string" ? message.id : null;
  const model = typeof message.model === "string" ? message.model : "";
  return { id, entry: { model, totals: totalsFromApiUsage(message.usage) } };
}

/** Sums a transcript's usage per model, each API response counted once. */
export function parseTranscript(text: string): UsageByModel {
  const byId = new Map<string, Entry>();
  const anonymous: Entry[] = [];
  for (const line of text.split("\n")) {
    const parsed = parseLine(line);
    if (parsed === null) continue;
    if (parsed.id === null) anonymous.push(parsed.entry);
    else byId.set(parsed.id, parsed.entry);
  }
  const byModel: UsageByModel = {};
  for (const { model, totals } of [...anonymous, ...byId.values()]) {
    byModel[model] = addTotals(byModel[model] ?? emptyTotals(), totals);
  }
  return byModel;
}
