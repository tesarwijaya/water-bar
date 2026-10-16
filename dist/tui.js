// src/tui.tsx
import { setProp as _$setProp } from "@opentui/solid";
import { effect as _$effect } from "@opentui/solid";
import { insert as _$insert } from "@opentui/solid";
import { createTextNode as _$createTextNode } from "@opentui/solid";
import { insertNode as _$insertNode } from "@opentui/solid";
import { createElement as _$createElement } from "@opentui/solid";
import { createComponent as _$createComponent } from "@opentui/solid";
import { createMemo, Show } from "solid-js";

// core/water.ts
var CACHE_READ_FACTOR = 0.1;
var CACHE_WRITE_FACTOR = 1;
var ENERGY_WH_PER_KTOK = {
  efficient: { input: 0.05, output: 0.3 },
  standard: { input: 0.2, output: 1.5 },
  frontier: { input: 0.5, output: 3 },
  reasoning: { input: 0.7, output: 6 }
};
var REGIONS = {
  us: { wueSite: 0.3, pue: 1.15, ewif: 4.5 },
  eu: { wueSite: 0.3, pue: 1.15, ewif: 2 },
  asia: { wueSite: 0.5, pue: 1.25, ewif: 3.5 },
  global: { wueSite: 0.4, pue: 1.2, ewif: 4 },
  renewable: { wueSite: 0.3, pue: 1.1, ewif: 0.05 }
};
var REGION_NAMES = Object.keys(REGIONS);
function parseRegion(value) {
  const name = value?.trim().toLowerCase();
  return name !== void 0 && name in REGIONS ? name : null;
}
var CLASS_RULES = [
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
  ["mistral-small", "efficient"]
];
function classifyModel(model) {
  if (!model) return "standard";
  const lower = model.toLowerCase();
  for (const [needle, cls] of CLASS_RULES) {
    if (lower.includes(needle)) return cls;
  }
  return "standard";
}
function estimateWater(totals, model, region) {
  const coeff = ENERGY_WH_PER_KTOK[classifyModel(model)];
  const profile = REGIONS[parseRegion(region) ?? "global"];
  const decode = totals.output + totals.reasoning;
  const chargedInput = totals.input + totals.cacheWrite * CACHE_WRITE_FACTOR + totals.cacheRead * CACHE_READ_FACTOR;
  const energyWh = (coeff.input * chargedInput + coeff.output * decode) / 1e3;
  const energyKwh = energyWh / 1e3;
  const onsiteMl = energyKwh * profile.wueSite * 1e3;
  const offsiteMl = energyKwh * profile.pue * profile.ewif * 1e3;
  return { onsiteMl, offsiteMl, totalMl: onsiteMl + offsiteMl };
}
function estimateRange(totals, model) {
  return estimateUsageRange({ [model ?? ""]: totals });
}
function estimateUsage(byModel, region) {
  let onsiteMl = 0;
  let offsiteMl = 0;
  for (const [model, totals] of Object.entries(byModel)) {
    const part = estimateWater(totals, model || void 0, region);
    onsiteMl += part.onsiteMl;
    offsiteMl += part.offsiteMl;
  }
  return { onsiteMl, offsiteMl, totalMl: onsiteMl + offsiteMl };
}
function estimateUsageRange(byModel) {
  const totalsByRegion = REGION_NAMES.map((region) => estimateUsage(byModel, region).totalMl);
  return { minMl: Math.min(...totalsByRegion), maxMl: Math.max(...totalsByRegion) };
}
function fmtWater(value) {
  if (value >= 1e3) return `${(value / 1e3).toFixed(2)} L`;
  if (value >= 100) return `${value.toFixed(0)} mL`;
  return `${value.toFixed(1)} mL`;
}
var ANALOGIES = [
  { ml: 0.05, one: "drop", many: "drops" },
  { ml: 5, one: "teaspoon", many: "teaspoons" },
  { ml: 240, one: "cup of coffee", many: "cups of coffee" },
  { ml: 500, one: "bottle", many: "bottles" },
  { ml: 6e3, one: "toilet flush", many: "toilet flushes" },
  { ml: 65e3, one: "shower", many: "showers" },
  { ml: 15e4, one: "bath", many: "baths" }
];
function describeEquivalent(ml) {
  let chosen = ANALOGIES[0];
  let closest = Number.POSITIVE_INFINITY;
  for (const analogy of ANALOGIES) {
    const count2 = ml / analogy.ml;
    if (count2 < 1) continue;
    const distance = Math.abs(count2 - 20);
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

// src/region.ts
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
function regionFile() {
  const dir = process.env.WATER_CONFIG_DIR;
  if (dir) return join(dir, "region");
  const base = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(base, "water-bar", "region");
}
function currentRegion() {
  const fromEnv = parseRegion(process.env.WATER_REGION);
  if (fromEnv !== null) return fromEnv;
  try {
    return parseRegion(readFileSync(regionFile(), "utf8")) ?? "global";
  } catch {
    return "global";
  }
}

// src/tui.tsx
var WaterLine = (props) => {
  const theme = () => props.api.theme.current;
  const water = createMemo(() => {
    const totals = {
      input: 0,
      output: 0,
      reasoning: 0,
      cacheRead: 0,
      cacheWrite: 0
    };
    let model;
    for (const message of props.api.state.session.messages(props.sessionID)) {
      if (message.role !== "assistant") continue;
      totals.input += message.tokens.input;
      totals.output += message.tokens.output;
      totals.reasoning += message.tokens.reasoning;
      totals.cacheRead += message.tokens.cache.read;
      totals.cacheWrite += message.tokens.cache.write;
      model = message.modelID;
    }
    const total = totals.input + totals.output + totals.reasoning + totals.cacheRead + totals.cacheWrite;
    if (total === 0) return void 0;
    return {
      ...estimateWater(totals, model, currentRegion()),
      ...estimateRange(totals, model)
    };
  });
  return _$createComponent(Show, {
    get when() {
      return water();
    },
    fallback: null,
    children: (w) => (() => {
      var _el$ = _$createElement("box"), _el$2 = _$createElement("text"), _el$3 = _$createElement("b"), _el$5 = _$createElement("text"), _el$6 = _$createTextNode(` water \u2248 `), _el$7 = _$createElement("text"), _el$8 = _$createTextNode(`on-site `), _el$9 = _$createTextNode(` \xB7 off-site `), _el$0 = _$createElement("text"), _el$1 = _$createTextNode(`range `), _el$10 = _$createTextNode(` \u2013 `);
      _$insertNode(_el$, _el$2);
      _$insertNode(_el$, _el$5);
      _$insertNode(_el$, _el$7);
      _$insertNode(_el$, _el$0);
      _$insertNode(_el$2, _el$3);
      _$insertNode(_el$3, _$createTextNode(`Water Usage`));
      _$insertNode(_el$5, _el$6);
      _$insert(_el$5, () => fmtWater(w().totalMl), _el$6);
      _$insert(_el$5, () => describeEquivalent(w().totalMl), null);
      _$insertNode(_el$7, _el$8);
      _$insertNode(_el$7, _el$9);
      _$insert(_el$7, () => fmtWater(w().onsiteMl), _el$9);
      _$insert(_el$7, () => fmtWater(w().offsiteMl), null);
      _$insertNode(_el$0, _el$1);
      _$insertNode(_el$0, _el$10);
      _$insert(_el$0, () => fmtWater(w().minMl), _el$10);
      _$insert(_el$0, () => fmtWater(w().maxMl), null);
      _$effect((_p$) => {
        var _v$ = theme().text, _v$2 = theme().textMuted, _v$3 = theme().textMuted, _v$4 = theme().textMuted;
        _v$ !== _p$.e && (_p$.e = _$setProp(_el$2, "fg", _v$, _p$.e));
        _v$2 !== _p$.t && (_p$.t = _$setProp(_el$5, "fg", _v$2, _p$.t));
        _v$3 !== _p$.a && (_p$.a = _$setProp(_el$7, "fg", _v$3, _p$.a));
        _v$4 !== _p$.o && (_p$.o = _$setProp(_el$0, "fg", _v$4, _p$.o));
        return _p$;
      }, {
        e: void 0,
        t: void 0,
        a: void 0,
        o: void 0
      });
      return _el$;
    })()
  });
};
var tui = async (api) => {
  const slotPlugin = {
    order: 150,
    slots: {
      sidebar_content(_context, props) {
        return _$createComponent(WaterLine, {
          api,
          get sessionID() {
            return props.session_id;
          }
        });
      }
    }
  };
  api.slots.register(slotPlugin);
};
var plugin = {
  id: "water-bar.tui",
  tui
};
var tui_default = plugin;
export {
  tui_default as default
};
