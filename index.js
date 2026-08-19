/**
 * dsh-mushroom-forest — a DeepSeek Harness plugin that grows a mushroom garden
 * out of your session events.
 *
 * Every completed unit of work grows one gentle mushroom from an eight-species
 * table; every failure grows one red-cap-with-white-dots BUG mushroom. The bug
 * mushroom is a warning marker for "something errored here" — it is never
 * presented as food, and this plugin makes no nutrition, medical, or diet
 * claims of any kind.
 *
 * DSH surfaces used (all confirmed against the harness source, none invented):
 * - `session/event`, `session/created`, `session/flush` context events
 *   (packages/core/session/src/index.ts).
 * - `SessionEvent` envelope `{ type, seq, time, data }` and the `turn/end`
 *   (`data.reason.kind`) and `tool/result` (`data.error`, `data.message`)
 *   payloads (packages/core/session/src/types.ts).
 * - `ctx.commands.register({ name, description, input, handler })` returning a
 *   disposer (packages/interaction/commands/src/index.ts, mirroring
 *   packages/goal/command-goal/src/index.ts).
 *
 * @module dsh-mushroom-forest
 */

import Schema from '@deepseek-ai/schemastery'
import { randomBytes } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  BUG_MUSHROOM,
  GARDEN_SCHEMA,
  NOT_FOOD_NOTICE,
  NOT_FOOD_NOTICE_EN,
  SPECIES,
  emptyGarden,
  growBug,
  growGentle,
  normalizeGarden,
  pickSpecies,
  renderGarden,
  totalMushrooms,
} from './garden.js'
import { whisperFor } from './whispers.js'

export const name = 'mushroom-forest-deepseek-harness'

/**
 * `sessions` carries the event firehose the garden grows from; `commands` owns
 * the `/garden` registry. Both are DSH-provided services.
 */
export const inject = ['sessions', 'commands']

const GARDEN_FILE = 'garden.json'
const COMMAND_USAGE = 'Usage: /garden [show|where]'

export const Config = Schema.object({
  mode: Schema.union(['disabled', 'grow']).default('grow'),
  outputDir: Schema.union([Schema.string(), Schema.const(null)]).default(null),
  growOn: Schema.union(['turn', 'tool', 'turn+tool']).default('turn+tool'),
  countBugs: Schema.boolean().default(true),
  maxGrowthPerSession: Schema.number().default(2000),
  awaitOnFlush: Schema.boolean().default(true),
  commandName: Schema.string().default('garden'),
})

/**
 * Mount the forest for one harness context.
 * @param ctx - the plugin context.
 * @param config - validated {@link Config}.
 */
export function apply(ctx, config) {
  const forest = createMushroomForest(ctx, config)
  ctx.effect(() => {
    forest.start()
    return () => forest.dispose()
  })
}

/**
 * Build the forest observer without mounting it — the unit-testable core.
 * @param ctx - plugin context (only `on` and `commands` are used).
 * @param rawConfig - partial config; defaults mirror {@link Config}.
 * @param overrides - `{ store, now }` seams for tests.
 * @returns the forest handle (`start`, `dispose`, `observe`, `read`, `render`, …).
 */
export function createMushroomForest(ctx, rawConfig = {}, overrides = {}) {
  const config = normalizeConfig(rawConfig, { packageUrl: import.meta.url })
  const store = overrides.store ?? createFileGardenStore(config.outputDir)
  const now = overrides.now ?? (() => new Date().toISOString())
  const seenBySession = new Map()
  const grownBySession = new Map()
  let garden = null
  let loading = null
  let writeChain = Promise.resolve()
  let accepting = true
  let unlisteners = []

  async function ensureGarden() {
    if (garden) return garden
    loading ??= Promise.resolve()
      .then(() => store.read())
      .then((raw) => normalizeGarden(raw))
      .catch(() => emptyGarden())
    garden = await loading
    return garden
  }

  function seenSet(sessionId) {
    let seen = seenBySession.get(sessionId)
    if (!seen) {
      seen = new Set()
      seenBySession.set(sessionId, seen)
    }
    return seen
  }

  /**
   * Decide what one session event grows.
   * `tool/result` is the tool-side trigger rather than `tool/call`: only the
   * result carries the outcome, and counting both would double-count one call.
   * @param event - a `SessionEvent`.
   * @returns `'gentle'`, `'bug'`, or `null` for events the garden ignores.
   */
  function classify(event) {
    if (!event || typeof event.type !== 'string') return null
    if (event.type === 'turn/end') {
      if (config.growOn === 'tool') return null
      const kind = event.data?.reason?.kind ?? 'completed'
      if (kind === 'error') return config.countBugs ? 'bug' : null
      if (kind === 'completed') return 'gentle'
      return null
    }
    if (event.type === 'tool/result') {
      if (config.growOn === 'turn') return null
      if (isFailedToolResult(event.data)) return config.countBugs ? 'bug' : null
      return 'gentle'
    }
    return null
  }

  /**
   * Fold one session event into the garden.
   * @param session - the emitting session.
   * @param event - the event to classify and grow from.
   * @param source - which listener delivered it (diagnostics only).
   * @returns the sprout record, or `undefined` when nothing grew.
   */
  async function observe(session, event, source = 'session/event') {
    if (!accepting || config.mode === 'disabled') return undefined
    const kind = classify(event)
    if (!kind) return undefined
    const sessionId = sessionIdOf(session)
    const seen = seenSet(sessionId)
    const key = eventKey(event)
    if (seen.has(key)) return undefined
    seen.add(key)
    const grown = grownBySession.get(sessionId) ?? 0
    if (grown >= config.maxGrowthPerSession) return undefined
    grownBySession.set(sessionId, grown + 1)
    const state = await ensureGarden()
    const stamp = now()
    const sprout = kind === 'bug'
      ? growBug(state, stamp)
      : growGentle(state, `${sessionId}#${key}`, stamp)
    persist()
    return { ...sprout, source }
  }

  function persist() {
    const snapshot = () => JSON.parse(JSON.stringify(garden))
    writeChain = writeChain
      .then(() => (garden ? store.write(snapshot()) : undefined))
      .catch(() => undefined)
    return writeChain
  }

  function dispatch(session, event, source) {
    void observe(session, event, source).catch(() => undefined)
  }

  async function flush() {
    if (!config.awaitOnFlush) return
    await writeChain
  }

  async function render() {
    const state = await ensureGarden()
    return renderGarden(state, { whisper: whisperFor(state), path: store.path ?? '(in memory only)' })
  }

  async function handleCommand(invocation) {
    const input = String(invocation?.rawInput ?? '').trim().toLowerCase()
    if (input === '' || input === 'show') return { kind: 'success', text: await render() }
    if (input === 'where') {
      return {
        kind: 'success',
        text: store.path
          ? `苗圃 · garden file: ${store.path}\n⚠️ ${NOT_FOOD_NOTICE}`
          : `The garden is in memory only (no writable garden directory).\n⚠️ ${NOT_FOOD_NOTICE}`,
      }
    }
    return { kind: 'error', text: `Unknown /garden argument "${input}". ${COMMAND_USAGE}` }
  }

  function registerCommand() {
    const commands = ctx?.commands
    if (!commands || typeof commands.register !== 'function') return null
    const dispose = commands.register({
      name: config.commandName,
      description: 'show the mushroom garden grown from this profile\'s sessions (garden mushrooms are not food)',
      input: { hint: '[show|where]' },
      handler: (invocation) => handleCommand(invocation),
    })
    return typeof dispose === 'function' ? dispose : null
  }

  return {
    config,
    store,
    start() {
      if (config.mode === 'disabled') return
      unlisteners = [
        listen(ctx, 'session/event', (session, event) => dispatch(session, event, 'session/event')),
        listen(ctx, 'session/created', (session) => { seenSet(sessionIdOf(session)) }),
        listen(ctx, 'session/flush', () => flush()),
        registerCommand(),
      ].filter(Boolean)
    },
    async dispose() {
      accepting = false
      for (const off of unlisteners.splice(0)) off()
      await writeChain.catch(() => undefined)
      seenBySession.clear()
      grownBySession.clear()
    },
    observe,
    flush,
    render,
    handleCommand,
    classify,
    /** @returns the live in-memory garden (loading it on first read). */
    read: ensureGarden,
  }
}

/**
 * A `tool/result` counts as a bug when the harness recorded a structured
 * failure identity, or the model-facing result block is flagged `isError`.
 * @param data - the `tool/result` event payload.
 * @returns whether this result should grow a bug mushroom.
 */
export function isFailedToolResult(data) {
  if (!data || typeof data !== 'object') return false
  if (data.error && typeof data.error === 'object') return true
  const blocks = data.message?.content
  if (!Array.isArray(blocks)) return false
  return blocks.some((block) => block?.isError === true)
}

function eventKey(event) {
  return Number.isSafeInteger(event?.seq) ? `seq:${event.seq}` : `t:${event?.time ?? 0}:${event?.type}`
}

function sessionIdOf(session) {
  return String(session?.id ?? session?.header?.id ?? 'unknown-session')
}

function normalizeConfig(input = {}, options = {}) {
  const packageUrl = options.packageUrl ?? import.meta.url
  return {
    mode: input.mode ?? 'grow',
    outputDir: input.outputDir ?? defaultGardenDir(packageUrl),
    growOn: input.growOn ?? 'turn+tool',
    countBugs: input.countBugs ?? true,
    maxGrowthPerSession: input.maxGrowthPerSession ?? 2000,
    awaitOnFlush: input.awaitOnFlush ?? true,
    commandName: input.commandName ?? 'garden',
  }
}

/**
 * Where the garden lives by default: `<profile>/.mushroom-forest` when the
 * plugin was installed into a DSH profile (the route-certificate layout), and
 * `~/.dsh/mushroom-forest` otherwise so a garden still accumulates.
 * @param packageUrl - this module's URL.
 * @returns an absolute directory, or `null` when no home directory exists.
 */
export function defaultGardenDir(packageUrl = import.meta.url) {
  const packageDir = dirname(fileURLToPath(packageUrl))
  const profileDir = inferProfileDir(packageDir)
  if (profileDir) return join(profileDir, '.mushroom-forest')
  const home = homedir()
  return home && isAbsolute(home) ? join(home, '.dsh', 'mushroom-forest') : null
}

function inferProfileDir(packageDir) {
  let cursor = packageDir
  for (let depth = 0; depth < 16; depth += 1) {
    const base = dirname(cursor)
    if (base === cursor) return null
    if (basename(base) === 'node_modules') {
      const parent = dirname(base)
      const grandparent = dirname(parent)
      if (basename(grandparent) === '.pnpm') return dirname(dirname(grandparent))
      return parent
    }
    cursor = base
  }
  return null
}

/**
 * A crash-safe JSON garden file: write to a sibling temp file, then rename.
 * A null directory yields an in-memory-only store (reads empty, writes drop).
 * @param outputDir - absolute directory holding `garden.json`, or `null`.
 * @returns the store `{ path, read, write }`.
 */
export function createFileGardenStore(outputDir) {
  const path = outputDir && isAbsolute(outputDir) ? join(outputDir, GARDEN_FILE) : null
  return {
    path,
    async read() {
      if (!path) return null
      try {
        return JSON.parse(await readFile(path, 'utf8'))
      } catch {
        return null
      }
    },
    async write(garden) {
      if (!path) return false
      await mkdir(dirname(path), { recursive: true, mode: 0o700 })
      const temp = `${path}.${randomBytes(6).toString('hex')}.tmp`
      try {
        await writeFile(temp, `${JSON.stringify(garden, null, 2)}\n`, { mode: 0o600 })
        await rename(temp, path)
        return true
      } catch (error) {
        await rm(temp, { force: true }).catch(() => undefined)
        throw error
      }
    },
  }
}

function listen(ctx, event, fn) {
  const result = ctx?.on?.(event, fn)
  if (typeof result === 'function') return result
  if (result && typeof result.dispose === 'function') return () => result.dispose()
  if (result && typeof result[Symbol.dispose] === 'function') return () => result[Symbol.dispose]()
  return null
}

export const __testing = {
  BUG_MUSHROOM,
  GARDEN_SCHEMA,
  NOT_FOOD_NOTICE,
  NOT_FOOD_NOTICE_EN,
  SPECIES,
  createFileGardenStore,
  defaultGardenDir,
  emptyGarden,
  eventKey,
  isFailedToolResult,
  normalizeConfig,
  pickSpecies,
  renderGarden,
  sessionIdOf,
  totalMushrooms,
}
