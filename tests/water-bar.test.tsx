import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const HOME = '/home/someone'
const CWD = '/work/demo'
const SESSION = 'sess-1'
const TRANSCRIPT = `${HOME}/.claude/projects/-work-demo/${SESSION}.jsonl`
const REGION_FILE = `${HOME}/.config/water-bar/region`

type Host = { files: Map<string, string>; store: Map<string, unknown>; env: Record<string, string> }

/** Stands in for the machine: a home folder, the plugin's store and the session's figures. */
function fakeHost(on: On, options: { env?: Record<string, string>; files?: Record<string, string> } = {}): Host {
  const host: Host = {
    files: new Map(Object.entries(options.files ?? {})),
    store: new Map(),
    env: { HOME, ...options.env },
  }
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('turn.complete', ($, e) => ({ text: e.answer, usage: e.usage }))
  on('session.id', () => ({ value: SESSION }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.usage', () => ({
    value: { startedAt: 0, context: { window: 200_000, percent: 41.7 }, rateLimits: [], cost: { usd: 3.456 } },
  }))
  on('clock.now', () => ({ value: 1_000 }))
  on('env.get', ($, e) => ({ value: host.env[e.name] }))
  on('fs.exists', ($, e) => ({ value: host.files.has(e.path) }))
  on('fs.list', () => ({ value: [] }))
  on('fs.read', ($, e) => {
    const text = host.files.get(e.path)
    if (text === undefined) throw new Error(`ENOENT: ${e.path}`)
    if (text === 'TOO BIG') throw new Error('file is over 4 MiB')
    return { value: text }
  })
  on('fs.write', ($, e) => {
    host.files.set(e.path, e.text)
    return { value: undefined }
  })
  on('store.get', ($, e) => ({ value: host.store.get(e.key) }))
  on('store.set', ($, e) => {
    host.store.set(e.key, JSON.parse(JSON.stringify(e.value)))
    return { value: undefined }
  })
  on('store.keys', () => ({ value: [...host.store.keys()] }))
  on('store.delete', ($, e) => {
    host.store.delete(e.key)
    return { value: undefined }
  })
  return host
}

// 1M cached input + 2k output on Opus: 320 mL at the global profile.
const OPUS_TURN = {
  input_tokens: 1_000,
  output_tokens: 2_000,
  cache_read_input_tokens: 1_000_000,
  cache_creation_input_tokens: 10_000,
  model: 'claude-opus-5-5',
}

function turn(usage: typeof OPUS_TURN | undefined, agentId?: string) {
  return { answer: 'ok', durationMs: 10, isAborted: false, turnId: 't', reason: 'answer' as const, usage, agentId }
}

function transcriptLine(id: string, usage: Omit<typeof OPUS_TURN, 'model'>): string {
  return JSON.stringify({ type: 'assistant', message: { id, model: 'claude-opus-5-5', usage } })
}

const START = { cwd: CWD, surface: 'terminal', isInteractive: true } as const
const SITE = { scroll: { offset: 0, bodyRows: 10 }, view: {} }
const BAND_PROPS = { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120, ...SITE }

test('band shows nothing about water before the first reply', async ($, on) => {
  fakeHost(on)
  await $.session.start(START)

  const ui = await $.ui.mount({ plugin: 'water-bar', surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS })
  expect(await ui.find({ text: /Water Usage/ })).toBeUndefined()
  expect(await ui.find({ text: /claude-opus-5-5 · ctx 42% · \$3\.46/ })).toBeDefined()
  await ui.unmount()
})

test('each turn adds its tokens, subagent turns included', async ($, on) => {
  const host = fakeHost(on)
  await $.session.start(START)
  await $.turn.complete(turn(OPUS_TURN))
  await $.turn.complete(turn(OPUS_TURN, 'agent-1'))

  const stored = host.store.get(`session:${SESSION}`) as { byModel: Record<string, { cacheRead: number }> }
  expect(stored.byModel['claude-opus-5-5']?.cacheRead).toBe(2_000_000)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'water-bar', surface, component: 'AbovePrompt', props: BAND_PROPS })
    expect(await ui.find({ text: /Water Usage: 640 mL ≈ 2\.7 cups of coffee/ })).toBeDefined()
    expect((await ui.find({ key: 'region' }))?.text).toContain('global')
    await ui.unmount()
  }
})

test('a session begun before the band is read back from its transcript, once', async ($, on) => {
  const { model: _, ...usage } = OPUS_TURN
  // Two lines of one response repeat its usage; it counts once.
  const text = [transcriptLine('m1', usage), transcriptLine('m1', usage), ''].join('\n')
  const host = fakeHost(on, { files: { [TRANSCRIPT]: text } })
  // No session.start: the band was installed mid-session, the turn already in the transcript.
  await $.turn.complete(turn(OPUS_TURN))

  const stored = host.store.get(`session:${SESSION}`) as { byModel: Record<string, { cacheRead: number }>; isPartial: boolean }
  expect(stored.byModel['claude-opus-5-5']?.cacheRead).toBe(1_000_000)
  expect(stored.isPartial).toBe(false)
})

test('a transcript too large to read marks the total a lower bound', async ($, on) => {
  fakeHost(on, { files: { [TRANSCRIPT]: 'TOO BIG' } })
  await $.session.start(START)
  await $.turn.complete(turn(OPUS_TURN))

  const ui = await $.ui.mount({ plugin: 'water-bar', surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS })
  expect(await ui.find({ text: /Water Usage: ≥ 320 mL/ })).toBeDefined()
  await ui.unmount()
})

test('the region button cycles and saves the region', async ($, on) => {
  const host = fakeHost(on)
  await $.session.start(START)
  await $.turn.complete(turn(OPUS_TURN))

  const ui = await $.ui.mount({ plugin: 'water-bar', surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS })
  await ui.press({ key: 'region' })
  expect(host.files.get(REGION_FILE)).toBe('renewable\n')
  expect((await ui.find({ key: 'region' }))?.text).toContain('renewable')
  expect(await ui.find({ text: /Water Usage: 21\.8 mL/ })).toBeDefined()
  await ui.unmount()
})

test('a saved region is read back, and WATER_REGION overrides it', async ($, on) => {
  fakeHost(on, { env: { WATER_REGION: 'eu' }, files: { [REGION_FILE]: 'asia\n' } })
  await $.session.start(START)
  await $.turn.complete(turn(OPUS_TURN))

  const ui = await $.ui.mount({ plugin: 'water-bar', surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS })
  expect((await ui.find({ key: 'region' }))?.text).toContain('eu')
  await ui.press({ key: 'region' })
  expect(await ui.find({ text: /WATER_REGION=eu is set and overrides the picker/ })).toBeDefined()
  await ui.unmount()
})

test('band opens with a rule as wide as the band', async ($, on) => {
  fakeHost(on)
  await $.session.start(START)
  await $.turn.complete(turn(OPUS_TURN))

  const ui = await $.ui.mount({ plugin: 'water-bar', surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS })
  const rule = await ui.find({ type: 'Text', text: /^─+$/ })
  expect(rule?.text.length).toBe(BAND_PROPS.bodyColumns)
  await ui.unmount()
})
