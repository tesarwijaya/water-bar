/** @jsxImportSource @opentui/solid */
// `order: 150` is deliberate: the sidebar `sidebar_content` slot stacks builtin
// sections at 100 (Context), 200 (MCP), 300 (LSP), 400 (Todo), 500 (Files), so
// 150 renders this water line directly under the Context block.

import { createMemo, Show } from "solid-js"
import type { TuiPlugin, TuiPluginApi, TuiPluginModule, TuiSlotPlugin } from "@opencode-ai/plugin/tui"
import { describeEquivalent, estimateRange, estimateWater, fmtWater, type TokenTotals } from "../core/water.ts"
import { currentRegion } from "./region.ts"

const WaterLine = (props: { api: TuiPluginApi; sessionID: string }) => {
  const theme = () => props.api.theme.current

  const water = createMemo(() => {
    const totals: TokenTotals = {
      input: 0,
      output: 0,
      reasoning: 0,
      cacheRead: 0,
      cacheWrite: 0,
    }
    let model: string | undefined
    for (const message of props.api.state.session.messages(props.sessionID)) {
      if (message.role !== "assistant") continue
      totals.input += message.tokens.input
      totals.output += message.tokens.output
      totals.reasoning += message.tokens.reasoning
      totals.cacheRead += message.tokens.cache.read
      totals.cacheWrite += message.tokens.cache.write
      model = message.modelID
    }
    const total =
      totals.input + totals.output + totals.reasoning + totals.cacheRead + totals.cacheWrite
    if (total === 0) return undefined
    return { ...estimateWater(totals, model, currentRegion()), ...estimateRange(totals, model) }
  })

  return (
    <Show when={water()} fallback={null}>
      {(w) => (
        <box>
          <text fg={theme().text}>
            <b>Water Usage</b>
          </text>
          <text fg={theme().textMuted}>
            {fmtWater(w().totalMl)} water ≈ {describeEquivalent(w().totalMl)}
          </text>
          <text fg={theme().textMuted}>
            on-site {fmtWater(w().onsiteMl)} · off-site {fmtWater(w().offsiteMl)}
          </text>
          <text fg={theme().textMuted}>
            range {fmtWater(w().minMl)} – {fmtWater(w().maxMl)}
          </text>
        </box>
      )}
    </Show>
  )
}

const tui: TuiPlugin = async (api) => {
  const slotPlugin: TuiSlotPlugin = {
    order: 150,
    slots: {
      sidebar_content(_context, props) {
        return <WaterLine api={api} sessionID={props.session_id} />
      },
    },
  }
  api.slots.register(slotPlugin)
}

const plugin: TuiPluginModule & { id: string } = {
  id: "water-bar.tui",
  tui,
}

export default plugin
