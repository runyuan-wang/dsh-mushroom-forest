/**
 * Cozy one-line whispers from the forest floor, picked deterministically from
 * the garden's own counts so the same garden always whispers the same line.
 *
 * These are ambience for a dev tool. They never describe taste, edibility,
 * foraging, nutrition, or health.
 */

/** The whisper pool. Weather, moss, light — never food. */
export const WHISPERS = Object.freeze([
  '苔藓上落了一点光。 · A little light lands on the moss.',
  '雾从林子里慢慢退回去了。 · The mist is easing back into the trees.',
  '一只蜗牛路过，没有打扰任何人。 · A snail passed through and disturbed nobody.',
  '雨停了，菌盖上还挂着水。 · The rain stopped; the caps are still beaded.',
  '树影往东挪了一寸。 · The tree shadows moved an inch east.',
  '林子很安静，适合慢慢来。 · The forest is quiet; there is time to go slowly.',
  '风翻了一下落叶，又放回去了。 · The wind turned a leaf over, then put it back.',
  '有一圈新的菌丝在土下面伸展。 · New mycelium is stretching under the soil.',
])

/** Extra lines shown when bug mushrooms outnumber their usual share. */
export const BUSY_BUG_WHISPERS = Object.freeze([
  '红帽子最近冒得有点多，先歇一口气。 · Plenty of red caps lately — take a breath.',
  '报错菇是提醒，不是收成。 · Bug mushrooms are a reminder, never a harvest.',
])

function fold(garden) {
  const gentle = Number(garden?.gentleTotal) || 0
  const bugs = Number(garden?.bugTotal) || 0
  return { gentle, bugs, total: gentle + bugs }
}

/**
 * Pick the whisper for one garden state.
 * @param garden - the current garden.
 * @returns one whisper line (deterministic in the garden's counts).
 */
export function whisperFor(garden) {
  const { gentle, bugs, total } = fold(garden)
  if (total === 0) return '土是新的，什么都还没长出来。 · The soil is new; nothing has come up yet.'
  if (bugs > 0 && bugs * 2 >= gentle) return BUSY_BUG_WHISPERS[bugs % BUSY_BUG_WHISPERS.length]
  return WHISPERS[total % WHISPERS.length]
}
