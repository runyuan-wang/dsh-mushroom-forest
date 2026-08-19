import assert from 'node:assert/strict'
import test from 'node:test'

import {
  BUG_MUSHROOM,
  NOT_FOOD_NOTICE,
  NOT_FOOD_NOTICE_EN,
  SPECIES,
  SPECIES_IDS,
  emptyGarden,
  growBug,
  growGentle,
  normalizeGarden,
  pickSpecies,
  renderGarden,
  totalMushrooms,
} from '../garden.js'

test('the species table holds the eight gentle species with unique ids', () => {
  assert.equal(SPECIES.length, 8)
  assert.deepEqual(SPECIES_IDS, ['button', 'chanterelle', 'oyster', 'shiitake', 'enoki', 'porcini', 'inkcap', 'morel'])
  assert.equal(new Set(SPECIES_IDS).size, 8)
  for (const species of SPECIES) {
    assert.equal(species.glyph, '🍄‍🟫', `${species.id} must use the gentle brown cap`)
    assert.ok(species.zh.length > 0)
  }
})

test('the bug mushroom is the red-cap-white-dot warning marker, never food', () => {
  assert.equal(BUG_MUSHROOM.glyph, '🍄')
  assert.equal(BUG_MUSHROOM.zh, '报错菇')
  assert.match(BUG_MUSHROOM.meaning, /not food/)
  assert.ok(!SPECIES_IDS.includes(BUG_MUSHROOM.id), 'the bug mushroom is not a gentle species')
})

test('pickSpecies is deterministic and always lands inside the table', () => {
  assert.equal(pickSpecies('sess-1#seq:1').id, pickSpecies('sess-1#seq:1').id)
  const hit = new Set()
  for (let index = 0; index < 200; index += 1) {
    const species = pickSpecies(`sess-a#seq:${index}`)
    assert.ok(SPECIES_IDS.includes(species.id))
    hit.add(species.id)
  }
  assert.equal(hit.size, 8, 'every species should be reachable')
})

test('growth updates per-species counts, the gentle total, and the bug count', () => {
  const garden = emptyGarden()
  const grown = []
  for (let index = 0; index < 5; index += 1) grown.push(growGentle(garden, `s#${index}`, '2026-08-19T00:00:00.000Z'))
  growBug(garden, '2026-08-19T00:00:01.000Z')
  growBug(garden, '2026-08-19T00:00:02.000Z')

  assert.equal(garden.gentleTotal, 5)
  assert.equal(garden.bugTotal, 2)
  assert.equal(totalMushrooms(garden), 7)
  const sum = SPECIES_IDS.reduce((total, id) => total + garden.species[id], 0)
  assert.equal(sum, 5, 'per-species counts must add up to the gentle total')
  for (const sprout of grown) assert.equal(sprout.kind, 'gentle')
  assert.equal(garden.firstGrownAt, '2026-08-19T00:00:00.000Z')
  assert.equal(garden.updatedAt, '2026-08-19T00:00:02.000Z')
})

test('normalizeGarden repairs corrupt or partial state instead of throwing', () => {
  assert.deepEqual(normalizeGarden(null), emptyGarden())
  const repaired = normalizeGarden({ species: { button: 3, oyster: -2, bogus: 99 }, bugTotal: 'x' })
  assert.equal(repaired.species.button, 3)
  assert.equal(repaired.species.oyster, 0)
  assert.equal(repaired.gentleTotal, 3)
  assert.equal(repaired.bugTotal, 0)
  assert.ok(!('bogus' in repaired.species))
})

test('renderGarden shows every count, the bug count, and the not-food notice', () => {
  const garden = emptyGarden()
  garden.species.shiitake = 4
  garden.species.morel = 1
  garden.gentleTotal = 5
  garden.bugTotal = 3

  const text = renderGarden(garden, { whisper: 'test whisper', path: '/tmp/garden.json' })
  assert.match(text, /gentle mushrooms — 5/)
  assert.match(text, /bug mushrooms — 3/)
  assert.match(text, /shiitake 香菇\s+4/)
  assert.match(text, /morel 羊肚菌\s+1/)
  assert.ok(!text.includes('button'), 'species with no mushrooms stay out of the bed')
  assert.ok(text.includes(NOT_FOOD_NOTICE), 'the Chinese not-food notice is mandatory')
  assert.ok(text.includes(NOT_FOOD_NOTICE_EN))
  assert.match(text, /test whisper/)
  assert.match(text, /\/tmp\/garden\.json/)
})

test('an empty garden still renders the safety framing', () => {
  const text = renderGarden(emptyGarden())
  assert.match(text, /gentle mushrooms — 0/)
  assert.match(text, /bug mushrooms — 0/)
  assert.ok(text.includes(NOT_FOOD_NOTICE))
})

test('no rendered string frames a mushroom as edible', () => {
  const garden = emptyGarden()
  growGentle(garden, 'a')
  growBug(garden)
  const text = renderGarden(garden, { whisper: 'quiet' })
  assert.doesNotMatch(text, /edible|好吃|可食用|tasty|delicious|采食|食用/iu)
  assert.match(text, /不能吃/u)
})
