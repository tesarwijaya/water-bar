// The water band above the prompt. It totals this session's tokens from the
// engine's own turn reports (the API's exact counts, subagent turns included),
// keeps them per session in $.store, and estimates the water with the shared
// core in ../core, the same code the OpenCode plugin runs. The model, context
// fill and cost beside it are the engine's own figures.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { parseTranscript, totalsFromApiUsage } from '../core/transcript.ts'
import {
  REGION_NAMES,
  addTotals,
  describeEquivalent,
  emptyTotals,
  estimateUsage,
  estimateUsageRange,
  fmtWater,
  parseRegion,
  totalTokens,
  type Region,
  type TokenTotals,
  type UsageByModel,
} from '../core/water.ts'
import type { SessionInfo, WaterView } from '../types'

const DOT = ' · '
const SESSION_KEY = 'session:'
// Sessions kept in the store; the oldest beyond this are dropped at start.
const MAX_SESSIONS = 200

const water = atom({ plugin: 'water-bar', key: 'water' } as const, null)
const info = atom({ plugin: 'water-bar', key: 'info' } as const, null)
const notice = atom({ plugin: 'water-bar', key: 'notice' } as const, null)

/** One session's usage as kept in $.store under `session:<id>`. */
type Stored = {
  byModel: UsageByModel
  /** The model of the last turn: what a compaction's summarizer is charged as. */
  lastModel: string | null
  /** True when turns before the band joined could not be read back. */
  isPartial: boolean
  updatedAt: number
}

function freshStored(): Stored {
  return { byModel: {}, lastModel: null, isPartial: false, updatedAt: 0 }
}

function asNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

/** A stored session read back defensively: the store file is the user's to edit. */
function asStored(value: unknown): Stored | null {
  if (typeof value !== 'object' || value === null) return null
  const v = value as Record<string, unknown>
  if (typeof v.byModel !== 'object' || v.byModel === null) return null
  const byModel: UsageByModel = {}
  for (const [model, raw] of Object.entries(v.byModel as Record<string, unknown>)) {
    const t = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
    byModel[model] = {
      input: asNumber(t.input),
      output: asNumber(t.output),
      reasoning: asNumber(t.reasoning),
      cacheRead: asNumber(t.cacheRead),
      cacheWrite: asNumber(t.cacheWrite),
    }
  }
  return {
    byModel,
    lastModel: typeof v.lastModel === 'string' ? v.lastModel : null,
    isPartial: v.isPartial === true,
    updatedAt: asNumber(v.updatedAt),
  }
}

// --- region -----------------------------------------------------------------

/** `$WATER_CONFIG_DIR`, else `$XDG_CONFIG_HOME/water-bar`, else `~/.config/water-bar`. */
async function regionFile($: EngineInterface): Promise<string | null> {
  const dir = await $.env.get('WATER_CONFIG_DIR')
  if (dir) return `${dir}/region`
  const xdg = await $.env.get('XDG_CONFIG_HOME')
  const home = await $.env.get('HOME')
  const base = xdg || (home ? `${home}/.config` : null)
  return base === null ? null : `${base}/water-bar/region`
}

/** `$WATER_REGION`, then the region the picker saved, then global. */
async function currentRegion($: EngineInterface): Promise<Region> {
  const fromEnv = parseRegion(await $.env.get('WATER_REGION'))
  if (fromEnv !== null) return fromEnv
  const file = await regionFile($)
  const saved = file === null ? null : await $.fs.read(file).catch(() => null)
  return parseRegion(saved) ?? 'global'
}

function nextRegion(region: Region): Region {
  return REGION_NAMES[(REGION_NAMES.indexOf(region) + 1) % REGION_NAMES.length] ?? 'global'
}

// --- backfill ---------------------------------------------------------------

// The session's cwd, for finding its transcript; unknown after a hot reload.
let sessionCwd: string | null = null

/** `<config>/projects/<project>/<id>.jsonl`, where Claude Code keeps the session. */
async function findTranscript($: EngineInterface, id: string): Promise<string | null> {
  if (!/^[A-Za-z0-9_-]+$/.test(id)) return null
  const config = await $.env.get('CLAUDE_CONFIG_DIR')
  const home = await $.env.get('HOME')
  const root = config || (home ? `${home}/.claude` : null)
  if (root === null) return null
  const projects = `${root}/projects`
  if (sessionCwd !== null) {
    // Claude Code names a project's folder after its cwd, every other character a dash.
    const guess = `${projects}/${sessionCwd.replace(/[^A-Za-z0-9]/g, '-')}/${id}.jsonl`
    if (await $.fs.exists(guess)) return guess
  }
  for (const entry of await $.fs.list(projects).catch(() => [])) {
    if (entry.kind !== 'dir') continue
    const path = `${projects}/${entry.name}/${id}.jsonl`
    if (await $.fs.exists(path)) return path
  }
  return null
}

/**
 * Usage of a session the store has never seen: a new session, or one begun
 * before the band was installed (or resumed from elsewhere). The latter is
 * read back from its transcript when one read can hold it (4 MiB); past that
 * the band counts from now on and marks the total a lower bound.
 */
async function backfill($: EngineInterface, id: string): Promise<{ stored: Stored; hasHistory: boolean }> {
  const path = await findTranscript($, id).catch(() => null)
  if (path === null) return { stored: freshStored(), hasHistory: false }
  try {
    const byModel = parseTranscript(await $.fs.read(path))
    const lastModel = Object.keys(byModel).at(-1) ?? null
    return { stored: { ...freshStored(), byModel, lastModel }, hasHistory: true }
  } catch {
    return { stored: { ...freshStored(), isPartial: true }, hasHistory: false }
  }
}

// --- the session's totals -----------------------------------------------------

// Store reads and writes one at a time, so two turns ending together both count.
let queue: Promise<unknown> = Promise.resolve()

function serially<T>(work: () => Promise<T>): Promise<T> {
  const run = queue.then(work, work)
  queue = run.catch(() => undefined)
  return run
}

type Spend = {
  totals: TokenTotals
  model: string | null
  /** True when the main transcript records it, so a backfill already counted it. */
  isInTranscript: boolean
}

/** Adds what a call spent to the session's totals and saves them; returns them. */
function record($: EngineInterface, spend: Spend | null): Promise<Stored> {
  return serially(async () => {
    const id = await $.session.id()
    const key = SESSION_KEY + id
    const existing = asStored(await $.store.get(key).catch(() => undefined))
    const { stored, hasHistory } = existing !== null
      ? { stored: existing, hasHistory: false }
      : await backfill($, id)
    if (spend !== null && !(hasHistory && spend.isInTranscript)) {
      const model = spend.model ?? stored.lastModel ?? ''
      stored.byModel[model] = addTotals(stored.byModel[model] ?? emptyTotals(), spend.totals)
      if (spend.model !== null) stored.lastModel = spend.model
    }
    stored.updatedAt = await $.clock.now()
    await $.store.set(key, stored).catch(() => undefined)
    return stored
  })
}

/** Drops all but the MAX_SESSIONS most recently updated sessions from the store. */
async function prune($: EngineInterface): Promise<void> {
  const keys = (await $.store.keys()).filter(key => key.startsWith(SESSION_KEY))
  if (keys.length <= MAX_SESSIONS) return
  const dated = await Promise.all(
    keys.map(async key => ({ key, at: asStored(await $.store.get(key))?.updatedAt ?? 0 })),
  )
  dated.sort((a, b) => b.at - a.at)
  for (const { key } of dated.slice(MAX_SESSIONS)) await $.store.delete(key)
}

// --- drawing ----------------------------------------------------------------

function toView(stored: Stored, region: Region): WaterView | null {
  const all = Object.values(stored.byModel).reduce(addTotals, emptyTotals())
  if (totalTokens(all) === 0) return null
  const estimate = estimateUsage(stored.byModel, region)
  const range = estimateUsageRange(stored.byModel)
  return {
    region,
    total: fmtWater(estimate.totalMl),
    equivalent: describeEquivalent(estimate.totalMl),
    onsite: fmtWater(estimate.onsiteMl),
    offsite: fmtWater(estimate.offsiteMl),
    span: `${fmtWater(range.minMl)} – ${fmtWater(range.maxMl)}`,
    isPartial: stored.isPartial,
  }
}

async function readInfo($: EngineInterface): Promise<SessionInfo | null> {
  try {
    const [model, usage] = await Promise.all([$.session.model(), $.session.usage()])
    return {
      model: model || null,
      contextPercent: usage.context.percent ?? null,
      costUsd: usage.cost?.usd ?? null,
    }
  } catch {
    return null
  }
}

/** Redraws the band from the session's totals (read from the store if not given). */
async function publish($: EngineInterface, stored?: Stored): Promise<void> {
  const current = stored ?? asStored(await $.store.get(SESSION_KEY + (await $.session.id())).catch(() => undefined))
  const next = current === null ? null : toView(current, await currentRegion($))
  const nextInfo = await readInfo($)
  await update($, water, () => next)
  await update($, info, () => nextInfo)
}

async function chooseRegion($: EngineInterface, region: Region): Promise<void> {
  const file = await regionFile($)
  let message: string | null = null
  if (file === null) message = 'HOME is not set, so the region cannot be saved'
  else await $.fs.write(file, `${region}\n`).catch(() => { message = `could not save the region to ${file}` })
  await publish($)
  const now = await read($, water)
  if (message === null && now !== null && now.region !== region) {
    message = `WATER_REGION=${now.region} is set and overrides the picker`
  }
  await update($, notice, () => message)
}

/** Records a spend and redraws; never throws, so bookkeeping cannot disturb a turn. */
async function count($: EngineInterface, spend: Spend | null): Promise<void> {
  try {
    await publish($, await record($, spend))
  } catch {
    // The band keeps its last drawing; the next turn tries again.
  }
}

function infoParts(i: SessionInfo | null): string[] {
  if (i === null) return []
  const parts: string[] = []
  if (i.model) parts.push(i.model)
  if (i.contextPercent !== null) parts.push(`ctx ${Math.round(i.contextPercent)}%`)
  if (i.costUsd !== null) parts.push(`$${i.costUsd.toFixed(2)}`)
  return parts
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    sessionCwd = e.cwd
    const done = await next(e)
    await count($, null)
    await prune($).catch(() => undefined)

    return done
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    const usage = e.usage ?? done.usage
    const spend = usage === undefined
      ? null
      : { totals: totalsFromApiUsage(usage), model: usage.model || null, isInTranscript: e.agentId === undefined }
    await count($, spend)

    return done
  })

  // The summarizer of a compaction is a model call no turn reports.
  on('session.compact', async ($, e, next) => {
    const done = await next(e)
    if ('usage' in done && done.usage !== undefined) {
      await count($, { totals: totalsFromApiUsage(done.usage), model: null, isInTranscript: false })
    }

    return done
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const w = await read($, water)
    const parts = infoParts(await read($, info))
    const message = await read($, notice)
    if (w === null && parts.length === 0 && message === null) return next(e)

    const { Box, Button, Text } = $.ui.resolve(e)
    const region = w?.region ?? 'global'

    return (
      <Box flexDirection="column">
        <Text dimColor wrap="truncate-end">
          {'─'.repeat(Math.max(1, e.props.bodyColumns))}
        </Text>
        {/* paddingTop only: the engine already leaves one row under the band. */}
        <Box flexDirection="row" columnGap={1} paddingTop={1}>
          <Box flexShrink={1}>
            <Text wrap="truncate-end">
              {w !== null && (
                <Text>
                  {'\u{1F4A7} Water Usage: '}
                  <Text bold>{(w.isPartial ? '≥ ' : '') + w.total}</Text>
                  {` ≈ ${w.equivalent}`}
                  <Text dimColor>{` (on-site ${w.onsite}, off-site ${w.offsite}, range ${w.span})`}</Text>
                </Text>
              )}
              {parts.length > 0 && <Text dimColor>{(w !== null ? DOT : '') + parts.join(DOT)}</Text>}
            </Text>
          </Box>
          {w !== null && (
            <Button key="region" hotkey="r" onPress={() => chooseRegion($, nextRegion(region))}>
              Region: {region}
            </Button>
          )}
        </Box>
        {message !== null && (
          <Text color="warning" wrap="truncate-end">
            {message}
          </Text>
        )}
      </Box>
    )
  })
}
