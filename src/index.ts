import { tool, type Plugin } from "@opencode-ai/plugin";
import { describeEquivalent, estimateRange, estimateWater, fmtWater, type TokenTotals } from "../core/water.ts";
import { currentRegion } from "./region.ts";

export const WaterBarPlugin: Plugin = async (ctx) => {
  return {
    tool: {
      water_bar: tool({
        description:
          "Estimate the water consumed by the current OpenCode session from its token usage.",
        args: {},
        async execute(_args, context) {
          const totals: TokenTotals = {
            input: 0,
            output: 0,
            reasoning: 0,
            cacheRead: 0,
            cacheWrite: 0,
          };
          let model: string | undefined;

          const res = await ctx.client.session.messages({
            path: { id: context.sessionID },
          });
          for (const entry of res.data ?? []) {
            const info = entry.info;
            if (info.role !== "assistant") continue;
            totals.input += info.tokens.input;
            totals.output += info.tokens.output;
            totals.reasoning += info.tokens.reasoning;
            totals.cacheRead += info.tokens.cache.read;
            totals.cacheWrite += info.tokens.cache.write;
            model = info.modelID;
          }

          const region = currentRegion();
          const breakdown = estimateWater(totals, model, region);
          const range = estimateRange(totals, model);
          const totalTokens =
            totals.input + totals.output + totals.reasoning + totals.cacheRead + totals.cacheWrite;

          return [
            `Water (this session): ${fmtWater(breakdown.totalMl)} \u2248 ${describeEquivalent(breakdown.totalMl)}`,
            `  on-site ${fmtWater(breakdown.onsiteMl)} \u00b7 off-site ${fmtWater(breakdown.offsiteMl)} \u00b7 range ${fmtWater(range.minMl)}\u2013${fmtWater(range.maxMl)}`,
            `  (${totalTokens} tokens, region: ${region}; order-of-magnitude estimate)`,
          ].join("\n");
        },
      }),
    },
  };
};
