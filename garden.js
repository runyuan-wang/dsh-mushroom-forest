/**
 * The garden model for dsh-mushroom-forest: the species table, the growth
 * bookkeeping, and the `/garden` renderer.
 *
 * Framing note (load-bearing, not decoration): this is a developer-tool
 * metaphor. Nothing in this file is foraging, cooking, nutrition, or health
 * guidance. The red-cap-with-white-dots mushroom is the classic "do not eat
 * me" silhouette and it is used here purely as a BUG MARKER.
 */

/** Schema tag stamped into the persisted garden file. */
export const GARDEN_SCHEMA = 'mushroom-forest.garden/v1'

/** Persisted-state version; bumped only when the on-disk shape changes. */
export const GARDEN_VERSION = 1

/** The mandatory safety line. Rendered on every garden view and in the README. */
export const NOT_FOOD_NOTICE = '蘑菇园里的蘑菇都不能吃；红帽白点菇 = 有 bug / 报错菇'

/** English mirror of {@link NOT_FOOD_NOTICE}, shown on the following line. */
export const NOT_FOOD_NOTICE_EN
  = 'Garden mushrooms are not food. Red cap + white dots = this run had bugs.'

/**
 * The eight gentle species. Every completed unit of work grows exactly one of
 * them. `cap` is the ASCII silhouette used in the garden bed; `glyph` is the
 * brown mushroom emoji shared by all gentle species (only the bug mushroom
 * gets the red cap).
 */
export const SPECIES = Object.freeze([
  { id: 'button', label: 'button', zh: '双孢菇', cap: '(o)', glyph: '🍄‍🟫' },
  { id: 'chanterelle', label: 'chanterelle', zh: '鸡油菌', cap: '{v}', glyph: '🍄‍🟫' },
  { id: 'oyster', label: 'oyster', zh: '平菇', cap: '<=>', glyph: '🍄‍🟫' },
  { id: 'shiitake', label: 'shiitake', zh: '香菇', cap: '(~)', glyph: '🍄‍🟫' },
  { id: 'enoki', label: 'enoki', zh: '金针菇', cap: 'iii', glyph: '🍄‍🟫' },
  { id: 'porcini', label: 'porcini', zh: '牛肝菌', cap: '(O)', glyph: '🍄‍🟫' },
  { id: 'inkcap', label: 'inkcap', zh: '墨汁鬼伞', cap: '(!)', glyph: '🍄‍🟫' },
  { id: 'morel', label: 'morel', zh: '羊肚菌', cap: '(#)', glyph: '🍄‍🟫' },
].map(Object.freeze))

/** Every gentle species id, in table order. */
export const SPECIES_IDS = Object.freeze(SPECIES.map((species) => species.id))

/**
 * The bug mushroom. Red cap, white dots — a warning silhouette standing in for
 * "something errored here". It is never presented as edible.
 */
export const BUG_MUSHROOM = Object.freeze({
  id: 'bug',
  label: 'bug mushroom',
  zh: '报错菇',
  cap: '(x)',
  glyph: '🍄',
  meaning: 'red cap + white dots = a tool call or turn failed here (warning marker, not food)',
})

/** @returns a fresh empty garden. */
export function emptyGarden() {
  const species = {}
  for (const id of SPECIES_IDS) species[id] = 0
  return {
    schema: GARDEN_SCHEMA,
    version: GARDEN_VERSION,
    species,
    gentleTotal: 0,
    bugTotal: 0,
    firstGrownAt: null,
    updatedAt: null,
  }
}

function safeCount(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0
}

/**
 * Load a persisted garden tolerantly: unknown fields are dropped, missing or
 * corrupt counters fall back to zero, and an unreadable file yields an empty
 * garden rather than an exception. A garden is a keepsake, not a ledger —
 * losing a mushroom is better than refusing to start.
 * @param raw - parsed JSON from the garden file (or anything at all).
 * @returns a normalized garden state.
 */
export function normalizeGarden(raw) {
  const garden = emptyGarden()
  if (!raw || typeof raw !== 'object') return garden
  const species = raw.species && typeof raw.species === 'object' ? raw.species : {}
  let gentle = 0
  for (const id of SPECIES_IDS) {
    garden.species[id] = safeCount(species[id])
    gentle += garden.species[id]
  }
  garden.gentleTotal = gentle
  garden.bugTotal = safeCount(raw.bugTotal)
  garden.firstGrownAt = typeof raw.firstGrownAt === 'string' ? raw.firstGrownAt : null
  garden.updatedAt = typeof raw.updatedAt === 'string' ? raw.updatedAt : null
  return garden
}

/** FNV-1a over a seed string — deterministic species choice without randomness. */
function hashSeed(seed) {
  let hash = 0x811c9dc5
  const text = String(seed ?? '')
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash >>> 0
}

/**
 * Choose which gentle species a piece of work grows.
 * Deterministic: the same seed always grows the same species, so a replayed
 * log reproduces the same garden.
 * @param seed - any stable string (session id + event seq works well).
 * @returns the chosen species record.
 */
export function pickSpecies(seed) {
  return SPECIES[hashSeed(seed) % SPECIES.length]
}

/**
 * Grow one gentle mushroom.
 * @param garden - garden state, mutated in place.
 * @param seed - stable seed selecting the species.
 * @param now - ISO timestamp for the growth (defaults to now).
 * @returns the sprout record `{ kind: 'gentle', species }`.
 */
export function growGentle(garden, seed, now = new Date().toISOString()) {
  const species = pickSpecies(seed)
  garden.species[species.id] = safeCount(garden.species[species.id]) + 1
  garden.gentleTotal = safeCount(garden.gentleTotal) + 1
  stamp(garden, now)
  return { kind: 'gentle', species }
}

/**
 * Grow one bug mushroom — the red-cap warning marker for a failed turn or a
 * failed tool result.
 * @param garden - garden state, mutated in place.
 * @param now - ISO timestamp for the growth (defaults to now).
 * @returns the sprout record `{ kind: 'bug', species: BUG_MUSHROOM }`.
 */
export function growBug(garden, now = new Date().toISOString()) {
  garden.bugTotal = safeCount(garden.bugTotal) + 1
  stamp(garden, now)
  return { kind: 'bug', species: BUG_MUSHROOM }
}

function stamp(garden, now) {
  if (!garden.firstGrownAt) garden.firstGrownAt = now
  garden.updatedAt = now
}

/** @returns total mushrooms of every kind in the garden. */
export function totalMushrooms(garden) {
  return safeCount(garden?.gentleTotal) + safeCount(garden?.bugTotal)
}

function bed(count, cap, limit = 12) {
  if (count <= 0) return '·'
  const shown = Math.min(count, limit)
  const row = Array.from({ length: shown }, () => cap).join(' ')
  return count > shown ? `${row} …` : row
}

/** Display width, counting CJK/full-width code points as two columns. */
function displayWidth(text) {
  let width = 0
  for (const char of text) {
    const code = char.codePointAt(0)
    width += (code >= 0x1100 && code <= 0x303e) || (code >= 0x3041 && code <= 0xa4cf)
      || (code >= 0xac00 && code <= 0xd7a3) || (code >= 0xf900 && code <= 0xfaff)
      || (code >= 0xff00 && code <= 0xff60) ? 2 : 1
  }
  return width
}

function pad(text, width) {
  const used = displayWidth(text)
  return used >= width ? text : text + ' '.repeat(width - used)
}

/**
 * Render the whole garden for `/garden`: per-species counts, the gentle total,
 * the bug count, and the mandatory not-food notice.
 * @param garden - garden state to render.
 * @param options - `whisper` (a cozy one-liner) and `path` (where the garden lives).
 * @returns the rendered multi-line string.
 */
export function renderGarden(garden, options = {}) {
  const state = normalizeGarden(garden)
  const lines = []
  lines.push('🌲 蘑菇森林 · Mushroom Forest 🌲')
  lines.push('')
  lines.push(`🍄‍🟫 温柔菇 gentle mushrooms — ${state.gentleTotal}`)
  if (state.gentleTotal === 0) {
    lines.push('   (苗圃还空着 · the beds are still empty — finish a turn to grow one)')
  } else {
    for (const species of SPECIES) {
      const count = state.species[species.id]
      if (count === 0) continue
      lines.push(`   ${pad(`${species.label} ${species.zh}`, 22)}${String(count).padStart(4)}  ${bed(count, species.cap)}`)
    }
  }
  lines.push('')
  lines.push(`🍄 报错菇 bug mushrooms — ${state.bugTotal}`)
  lines.push(`   ${bed(state.bugTotal, BUG_MUSHROOM.cap)}`)
  lines.push(`   ${BUG_MUSHROOM.meaning}`)
  lines.push('')
  if (options.whisper) {
    lines.push(`🌙 ${options.whisper}`)
    lines.push('')
  }
  lines.push(`⚠️ ${NOT_FOOD_NOTICE}`)
  lines.push(`   ${NOT_FOOD_NOTICE_EN}`)
  if (options.path) lines.push(`   苗圃 · garden file: ${options.path}`)
  return lines.join('\n')
}
