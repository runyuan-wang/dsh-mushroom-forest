import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { NOT_FOOD_NOTICE, SPECIES_IDS } from '../garden.js'
import { __testing, createMushroomForest } from '../testing.js'

function tempRoot() {
  return mkdtemp(join(tmpdir(), 'dsh-mushroom-forest-'))
}

/** Minimal stand-in for the harness context: the event bus plus the command registry. */
function makeCtx() {
  const handlers = new Map()
  const commands = new Map()
  return {
    sessions: { values: () => [] },
    commands: {
      register(definition) {
        assert.equal(typeof definition.name, 'string')
        assert.equal(typeof definition.description, 'string')
        assert.equal(typeof definition.handler, 'function')
        assert.equal(typeof definition.input.hint, 'string')
        commands.set(definition.name, definition)
        return () => commands.delete(definition.name)
      },
      get: (name) => commands.get(name),
      size: () => commands.size,
    },
    on(event, fn) {
      const rows = handlers.get(event) ?? []
      rows.push(fn)
      handlers.set(event, rows)
      return () => handlers.set(event, (handlers.get(event) ?? []).filter((row) => row !== fn))
    },
    emit(event, ...args) {
      return Promise.all((handlers.get(event) ?? []).map((fn) => fn(...args)))
    },
    count: (event) => (handlers.get(event) ?? []).length,
  }
}

function makeSession(id = 'sess-1') {
  return { id, header: { id, version: 0, cwd: '/tmp' }, events: [] }
}

function turnEnd(seq, reason = { kind: 'completed' }) {
  return { type: 'turn/end', seq, time: 1800000000000 + seq, data: { turn: seq, reason } }
}

function toolResult(seq, { error, isError } = {}) {
  return {
    type: 'tool/result',
    seq,
    time: 1800000000000 + seq,
    data: {
      turn: 1,
      step: 1,
      message: { role: 'user', content: [{ type: 'tool-result', toolCallId: `call-${seq}`, ...isError === undefined ? {} : { isError } }] },
      ...error ? { error } : {},
    },
  }
}

function invocation(rawInput = '') {
  return { commandId: 'cmd-1', agent: {}, rawInput, signal: new AbortController().signal }
}

async function withForest(run, extraConfig = {}) {
  const root = await tempRoot()
  const ctx = makeCtx()
  const forest = createMushroomForest(ctx, { outputDir: root, ...extraConfig })
  try {
    await run({ root, ctx, forest })
  } finally {
    await forest.dispose()
    await rm(root, { recursive: true, force: true })
  }
}

test('a completed turn grows one gentle mushroom', async () => {
  await withForest(async ({ forest }) => {
    const sprout = await forest.observe(makeSession(), turnEnd(1))
    assert.equal(sprout.kind, 'gentle')
    assert.ok(SPECIES_IDS.includes(sprout.species.id))
    const garden = await forest.read()
    assert.equal(garden.gentleTotal, 1)
    assert.equal(garden.bugTotal, 0)
    assert.equal(garden.species[sprout.species.id], 1)
  })
})

test('a failed turn and a failed tool result each grow one bug mushroom', async () => {
  await withForest(async ({ forest }) => {
    const session = makeSession()
    const fromTurn = await forest.observe(session, turnEnd(1, { kind: 'error', error: { message: 'boom', code: 'UNKNOWN' } }))
    const fromErrorField = await forest.observe(session, toolResult(2, { error: { name: 'ToolError', code: 'EACCES' } }))
    const fromIsError = await forest.observe(session, toolResult(3, { isError: true }))

    for (const sprout of [fromTurn, fromErrorField, fromIsError]) {
      assert.equal(sprout.kind, 'bug')
      assert.equal(sprout.species.glyph, '🍄')
      assert.equal(sprout.species.zh, '报错菇')
    }
    const garden = await forest.read()
    assert.equal(garden.bugTotal, 3)
    assert.equal(garden.gentleTotal, 0)
  })
})

test('a successful tool result grows a gentle mushroom; other outcomes grow nothing', async () => {
  await withForest(async ({ forest }) => {
    const session = makeSession()
    assert.equal((await forest.observe(session, toolResult(1, { isError: false }))).kind, 'gentle')
    assert.equal(await forest.observe(session, turnEnd(2, { kind: 'aborted', reason: { kind: 'user' } })), undefined)
    assert.equal(await forest.observe(session, turnEnd(3, { kind: 'max-tokens' })), undefined)
    assert.equal(await forest.observe(session, { type: 'assistant/chunk', seq: 4, time: 1, data: {} }), undefined)
    const garden = await forest.read()
    assert.equal(garden.gentleTotal, 1)
    assert.equal(garden.bugTotal, 0)
  })
})

test('growOn narrows which events grow mushrooms', async () => {
  await withForest(async ({ forest }) => {
    const session = makeSession()
    assert.equal(forest.classify(turnEnd(1)), 'gentle')
    assert.equal(forest.classify(toolResult(2)), null)
    await forest.observe(session, toolResult(2))
    assert.equal((await forest.read()).gentleTotal, 0)
  }, { growOn: 'turn' })

  await withForest(async ({ forest }) => {
    assert.equal(forest.classify(turnEnd(1)), null)
    assert.equal(forest.classify(toolResult(2)), 'gentle')
  }, { growOn: 'tool' })
})

test('replaying the same event does not grow a second mushroom', async () => {
  await withForest(async ({ forest }) => {
    const session = makeSession()
    const event = turnEnd(7)
    assert.ok(await forest.observe(session, event))
    assert.equal(await forest.observe(session, event, 'replay'), undefined)
    assert.equal(await forest.observe(session, turnEnd(7)), undefined)
    assert.equal((await forest.read()).gentleTotal, 1)
  })
})

test('the same seq in a different session still grows', async () => {
  await withForest(async ({ forest }) => {
    assert.ok(await forest.observe(makeSession('sess-a'), turnEnd(1)))
    assert.ok(await forest.observe(makeSession('sess-b'), turnEnd(1)))
    assert.equal((await forest.read()).gentleTotal, 2)
  })
})

test('maxGrowthPerSession caps one session without capping the next', async () => {
  await withForest(async ({ forest }) => {
    const session = makeSession('sess-capped')
    for (let seq = 1; seq <= 5; seq += 1) await forest.observe(session, turnEnd(seq))
    assert.equal((await forest.read()).gentleTotal, 2)
    await forest.observe(makeSession('sess-other'), turnEnd(1))
    assert.equal((await forest.read()).gentleTotal, 3)
  }, { maxGrowthPerSession: 2 })
})

test('the garden persists to disk and accumulates across sessions of the plugin', async () => {
  const root = await tempRoot()
  try {
    const first = createMushroomForest(makeCtx(), { outputDir: root })
    await first.observe(makeSession('sess-1'), turnEnd(1))
    await first.observe(makeSession('sess-1'), turnEnd(2, { kind: 'error', error: { message: 'x', code: 'UNKNOWN' } }))
    await first.flush()
    await first.dispose()

    const onDisk = JSON.parse(await readFile(join(root, 'garden.json'), 'utf8'))
    assert.equal(onDisk.schema, __testing.GARDEN_SCHEMA)
    assert.equal(onDisk.gentleTotal, 1)
    assert.equal(onDisk.bugTotal, 1)

    const second = createMushroomForest(makeCtx(), { outputDir: root })
    const reloaded = await second.read()
    assert.equal(reloaded.gentleTotal, 1)
    assert.equal(reloaded.bugTotal, 1)
    await second.observe(makeSession('sess-2'), turnEnd(1))
    await second.flush()
    await second.dispose()

    const grown = JSON.parse(await readFile(join(root, 'garden.json'), 'utf8'))
    assert.equal(grown.gentleTotal, 2)
    assert.equal(grown.bugTotal, 1)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a corrupt garden file starts an empty garden instead of throwing', async () => {
  const root = await tempRoot()
  try {
    await writeFile(join(root, 'garden.json'), '{ not json', 'utf8')
    const forest = createMushroomForest(makeCtx(), { outputDir: root })
    const garden = await forest.read()
    assert.equal(garden.gentleTotal, 0)
    await forest.observe(makeSession(), turnEnd(1))
    await forest.flush()
    assert.equal(JSON.parse(await readFile(join(root, 'garden.json'), 'utf8')).gentleTotal, 1)
    await forest.dispose()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('start() wires the session events and the /garden command; dispose() unwires them', async () => {
  await withForest(async ({ ctx, forest }) => {
    forest.start()
    assert.equal(ctx.count('session/event'), 1)
    assert.equal(ctx.count('session/created'), 1)
    assert.equal(ctx.count('session/flush'), 1)
    assert.equal(ctx.commands.size(), 1)

    const session = makeSession()
    await ctx.emit('session/created', session)
    await ctx.emit('session/event', session, turnEnd(1))
    await ctx.emit('session/event', session, toolResult(2, { isError: true }))
    await ctx.emit('session/flush', session)
    await forest.flush()

    const garden = await forest.read()
    assert.equal(garden.gentleTotal, 1)
    assert.equal(garden.bugTotal, 1)

    await forest.dispose()
    assert.equal(ctx.count('session/event'), 0)
    assert.equal(ctx.commands.size(), 0)
  })
})

test('/garden renders the whole garden, and rejects unknown arguments', async () => {
  await withForest(async ({ ctx, forest, root }) => {
    forest.start()
    const session = makeSession()
    for (let seq = 1; seq <= 3; seq += 1) await ctx.emit('session/event', session, turnEnd(seq))
    await ctx.emit('session/event', session, toolResult(9, { error: { name: 'ToolError', code: 'E' } }))
    await forest.flush()

    const command = ctx.commands.get('garden')
    assert.equal(command.description.includes('not food'), true)

    const shown = await command.handler(invocation(''))
    assert.equal(shown.kind, 'success')
    assert.match(shown.text, /gentle mushrooms — 3/)
    assert.match(shown.text, /bug mushrooms — 1/)
    assert.ok(shown.text.includes(NOT_FOOD_NOTICE))
    assert.match(shown.text, /报错菇/)

    const explicit = await command.handler(invocation(' show '))
    assert.equal(explicit.text, shown.text)

    const where = await command.handler(invocation('where'))
    assert.equal(where.kind, 'success')
    assert.ok(where.text.includes(join(root, 'garden.json')))
    assert.ok(where.text.includes(NOT_FOOD_NOTICE))

    const bad = await command.handler(invocation('harvest'))
    assert.equal(bad.kind, 'error')
    assert.match(bad.text, /Usage: \/garden/)
  })
})

test('disabled mode grows nothing and registers no command', async () => {
  await withForest(async ({ ctx, forest }) => {
    forest.start()
    assert.equal(ctx.count('session/event'), 0)
    assert.equal(ctx.commands.size(), 0)
    assert.equal(await forest.observe(makeSession(), turnEnd(1)), undefined)
    assert.equal((await forest.read()).gentleTotal, 0)
  }, { mode: 'disabled' })
})

test('countBugs:false keeps failures out of the garden entirely', async () => {
  await withForest(async ({ forest }) => {
    const session = makeSession()
    assert.equal(await forest.observe(session, turnEnd(1, { kind: 'error', error: { message: 'x', code: 'UNKNOWN' } })), undefined)
    assert.equal(await forest.observe(session, toolResult(2, { isError: true })), undefined)
    const garden = await forest.read()
    assert.equal(garden.bugTotal, 0)
    assert.equal(garden.gentleTotal, 0)
  }, { countBugs: false })
})

test('isFailedToolResult reads the confirmed tool/result payload shape', () => {
  assert.equal(__testing.isFailedToolResult(undefined), false)
  assert.equal(__testing.isFailedToolResult({ message: { content: [{ type: 'tool-result' }] } }), false)
  assert.equal(__testing.isFailedToolResult({ message: { content: [{ type: 'tool-result', isError: true }] } }), true)
  assert.equal(__testing.isFailedToolResult({ error: { name: 'E', code: 'C' } }), true)
})

test('the default garden directory is absolute and namespaced', () => {
  const dir = __testing.defaultGardenDir()
  assert.ok(dir === null || dir.includes('mushroom-forest'))
})
