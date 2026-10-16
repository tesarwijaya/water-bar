// The water estimator ("Model 2"), shared by the OpenCode plugin and the
// Claude Code band:
//
//   water = E_IT x (WUE_site + PUE x EWIF_grid)
//
// Pure functions only: it runs inside Claude Code's mod environment, which
// has no Node, so nothing here may import a runtime module.

export type ModelClass = "efficient" | "standard" | "frontier" | "reasoning";

export interface EnergyCoeff {
  input: number;
  output: number;
}

const CACHE_READ_FACTOR = 0.1;
const CACHE_WRITE_FACTOR = 1.0;

const ENERGY_WH_PER_KTOK: Record<ModelClass, EnergyCoeff> = {
  efficient: { input: 0.05, output: 0.3 },
  standard: { input: 0.2, output: 1.5 },
  frontier: { input: 0.5, output: 3.0 },
  reasoning: { input: 0.7, output: 6.0 },
};

export interface RegionProfile {
  wueSite: number;
  pue: number;
  ewif: number;
}

export type Region = "us" | "eu" | "asia" | "global" | "renewable";

const REGIONS: Record<Region, RegionProfile> = {
  us: { wueSite: 0.3, pue: 1.15, ewif: 4.5 },
  eu: { wueSite: 0.3, pue: 1.15, ewif: 2.0 },
  asia: { wueSite: 0.5, pue: 1.25, ewif: 3.5 },
  global: { wueSite: 0.4, pue: 1.2, ewif: 4.0 },
  renewable: { wueSite: 0.3, pue: 1.1, ewif: 0.05 },
};

export const REGION_NAMES = Object.keys(REGIONS) as readonly Region[];

/** A region name as typed (env var, saved file), or null when it is none. */
export function parseRegion(value: string | null | undefined): Region | null {
  const name = value?.trim().toLowerCase();
  return name !== undefined && name in REGIONS ? (name as Region) : null;
}

const CLASS_RULES: ReadonlyArray<readonly [string, ModelClass]> = [
  ["o3", "reasoning"],
  ["o4", "reasoning"],
  ["deepseek-r1", "reasoning"],
  ["gpt-4.1-mini", "standard"],
  ["gpt-4.1-nano", "efficient"],
  ["gpt-4o-mini", "standard"],
  ["gpt-4o-nano", "efficient"],
  ["gpt-4.1", "frontier"],
  ["gpt-4o", "frontier"],
  ["gpt-4", "frontier"],
  ["gpt-5", "frontier"],
  ["claude-opus", "frontier"],
  ["gemini-pro", "frontier"],
  ["claude-sonnet", "standard"],
  ["mistral-large", "standard"],
  ["llama-3.1-70", "standard"],
  ["llama-3.3-70", "standard"],
  ["claude-haiku", "efficient"],
  ["gemini-flash", "efficient"],
  ["gpt-3.5", "efficient"],
  ["llama", "efficient"],
  ["mistral-small", "efficient"],
];

export function classifyModel(model: string | undefined): ModelClass {
  if (!model) return "standard";
  const lower = model.toLowerCase();
  for (const [needle, cls] of CLASS_RULES) {
    if (lower.includes(needle)) return cls;
  }
  return "standard";
}

export interface TokenTotals {
  input: number;
  output: number;
  reasoning: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface WaterBreakdown {
  onsiteMl: number;
  offsiteMl: number;
  totalMl: number;
}

export function estimateWater(
  totals: TokenTotals,
  model: string | undefined,
  region: string,
): WaterBreakdown {
  const coeff = ENERGY_WH_PER_KTOK[classifyModel(model)];
  const profile = REGIONS[parseRegion(region) ?? "global"];
  const decode = totals.output + totals.reasoning;
  const chargedInput =
    totals.input +
    totals.cacheWrite * CACHE_WRITE_FACTOR +
    totals.cacheRead * CACHE_READ_FACTOR;
  const energyWh = (coeff.input * chargedInput + coeff.output * decode) / 1000;
  const energyKwh = energyWh / 1000;
  const onsiteMl = energyKwh * profile.wueSite * 1000;
  const offsiteMl = energyKwh * profile.pue * profile.ewif * 1000;
  return { onsiteMl, offsiteMl, totalMl: onsiteMl + offsiteMl };
}

export function estimateRange(
  totals: TokenTotals,
  model: string | undefined,
): { minMl: number; maxMl: number } {
  return estimateUsageRange({ [model ?? ""]: totals });
}

export function emptyTotals(): TokenTotals {
  return { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 };
}

export function addTotals(a: TokenTotals, b: TokenTotals): TokenTotals {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    reasoning: a.reasoning + b.reasoning,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite,
  };
}

export function totalTokens(t: TokenTotals): number {
  return t.input + t.output + t.reasoning + t.cacheRead + t.cacheWrite;
}

/**
 * Token totals per model id ("" when unknown), so a session that switched
 * models is charged each model's own energy rather than the last one's.
 */
export type UsageByModel = Record<string, TokenTotals>;

export function estimateUsage(byModel: UsageByModel, region: string): WaterBreakdown {
  let onsiteMl = 0;
  let offsiteMl = 0;
  for (const [model, totals] of Object.entries(byModel)) {
    const part = estimateWater(totals, model || undefined, region);
    onsiteMl += part.onsiteMl;
    offsiteMl += part.offsiteMl;
  }
  return { onsiteMl, offsiteMl, totalMl: onsiteMl + offsiteMl };
}

/** The same usage served from the driest and the thirstiest region. */
export function estimateUsageRange(byModel: UsageByModel): { minMl: number; maxMl: number } {
  const totalsByRegion = REGION_NAMES.map((region) => estimateUsage(byModel, region).totalMl);
  return { minMl: Math.min(...totalsByRegion), maxMl: Math.max(...totalsByRegion) };
}

export function fmtWater(value: number): string {
  if (value >= 1000) return `${(value / 1000).toFixed(2)} L`;
  if (value >= 100) return `${value.toFixed(0)} mL`;
  return `${value.toFixed(1)} mL`;
}

interface Analogy {
  ml: number;
  one: string;
  many: string;
}

const ANALOGIES: ReadonlyArray<Analogy> = [
  { ml: 0.05, one: "drop", many: "drops" },
  { ml: 5, one: "teaspoon", many: "teaspoons" },
  { ml: 240, one: "cup of coffee", many: "cups of coffee" },
  { ml: 500, one: "bottle", many: "bottles" },
  { ml: 6000, one: "toilet flush", many: "toilet flushes" },
  { ml: 65000, one: "shower", many: "showers" },
  { ml: 150000, one: "bath", many: "baths" },
];

export function describeEquivalent(ml: number): string {
  let chosen = ANALOGIES[0];
  let closest = Number.POSITIVE_INFINITY;
  for (const analogy of ANALOGIES) {
    const count = ml / analogy.ml;
    if (count < 1) continue;
    const distance = Math.abs(count - 20);
    if (distance < closest) {
      closest = distance;
      chosen = analogy;
    }
  }
  const count = ml / chosen.ml;
  const text = count >= 10 ? `${Math.round(count)}` : `${Math.round(count * 10) / 10}`;
  const noun = Math.abs(count - 1) < 0.05 ? chosen.one : chosen.many;
  return `${text} ${noun}`;
}
