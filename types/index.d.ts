export type WaterRegion = 'us' | 'eu' | 'asia' | 'global' | 'renewable'

/** This session's estimate, formatted for the band. */
export type WaterView = {
  region: WaterRegion
  total: string
  equivalent: string
  onsite: string
  offsite: string
  span: string
  /** Turns before the band joined the session could not be read back: a lower bound. */
  isPartial: boolean
}

/** What the engine itself reports for the session, as the status line had it. */
export type SessionInfo = {
  model: string | null
  contextPercent: number | null
  costUsd: number | null
}

declare module 'claude-code' {
  interface PluginState {
    'water-bar': { water: WaterView | null; info: SessionInfo | null; notice: string | null }
  }
}
