// The serving region, resolved the way the Claude Code band resolves it:
// $WATER_REGION, then the region its picker saved, then global.

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { parseRegion, type Region } from "../core/water.ts";

function regionFile(): string {
  const dir = process.env.WATER_CONFIG_DIR;
  if (dir) return join(dir, "region");
  const base = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(base, "water-bar", "region");
}

export function currentRegion(): Region {
  const fromEnv = parseRegion(process.env.WATER_REGION);
  if (fromEnv !== null) return fromEnv;
  try {
    return parseRegion(readFileSync(regionFile(), "utf8")) ?? "global";
  } catch {
    return "global";
  }
}
