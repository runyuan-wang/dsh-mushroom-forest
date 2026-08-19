# dsh-mushroom-forest

A small, cozy DeepSeek Harness plugin: your sessions grow a mushroom garden.

Every completed unit of work grows one **gentle mushroom** from an eight-species
table. Every failure grows one **red-cap-with-white-dots bug mushroom**. The
garden persists in your profile, so it keeps growing across sessions, and
`/garden` shows the whole bed.

## ⚠️ Safety framing — read this first

> **蘑菇园里的蘑菇都不能吃；红帽白点菇 = 有 bug / 报错菇**
>
> Garden mushrooms are not food. Red cap + white dots = this run had bugs.

The red-cap-white-dot mushroom is the classic "do not eat me" silhouette, and
this plugin uses it for exactly one thing: **marking errors**. It is a warning
glyph in a developer tool — a bug counter — never a snack, never a harvest,
never a thing to pick up in a real forest.

This plugin makes **no** nutrition, medical, detox, diet, foraging, or
identification claims of any kind. Nothing here helps you decide what is safe to
eat, and it must never be used that way. Real-world mushroom identification is a
serious matter with fatal failure modes; this is ASCII art about `turn/end`
events.

## What grows what

| Session event (confirmed against the harness source) | Grows |
| --- | --- |
| `turn/end` with `reason.kind === 'completed'` | 1 gentle mushroom 🍄‍🟫 |
| `turn/end` with `reason.kind === 'error'` | 1 bug mushroom 🍄 |
| `tool/result` with no `error` and no `isError` block | 1 gentle mushroom 🍄‍🟫 |
| `tool/result` with `data.error` or `content[].isError === true` | 1 bug mushroom 🍄 |
| `aborted`, `blocked`, `max-tokens`, `interrupted`, everything else | nothing |

`tool/result` is the tool-side trigger rather than `tool/call`, because only the
result carries an outcome — and counting both would double-count one call.

The eight gentle species: `button 双孢菇`, `chanterelle 鸡油菌`, `oyster 平菇`,
`shiitake 香菇`, `enoki 金针菇`, `porcini 牛肝菌`, `inkcap 墨汁鬼伞`,
`morel 羊肚菌`. Which one grows is a deterministic hash of the session id and
event seq, so a replayed log reproduces the same garden.

Each event grows at most one mushroom: growth is deduplicated by session id and
event `seq`, so a re-delivered or replayed event never inflates the counts.

## `/garden`

```text
🌲 蘑菇森林 · Mushroom Forest 🌲

🍄‍🟫 温柔菇 gentle mushrooms — 12
   shiitake 香菇            7  (~) (~) (~) (~) (~) (~) (~)
   morel 羊肚菌             5  (#) (#) (#) (#) (#)

🍄 报错菇 bug mushrooms — 2
   (x) (x)
   red cap + white dots = a tool call or turn failed here (warning marker, not food)

🌙 风翻了一下落叶，又放回去了。 · The wind turned a leaf over, then put it back.

⚠️ 蘑菇园里的蘑菇都不能吃；红帽白点菇 = 有 bug / 报错菇
   Garden mushrooms are not food. Red cap + white dots = this run had bugs.
   苗圃 · garden file: …/.mushroom-forest/garden.json
```

- `/garden` or `/garden show` — render the whole garden.
- `/garden where` — print the garden file path.

## Compatibility, dependencies, and permissions

- **DSH and Profile:** install into an existing profile that provides the DSH
  `sessions` and `commands` services. It adds no official `@deepseek-ai/*`
  component and replaces nothing.
- **Node.js and system:** requires Node.js `>=22.19.0`. Mechanically tested on
  macOS 14.4.1; other platforms are untested.
- **Runtime dependencies:** DSH session events, the DSH command registry, and
  `@deepseek-ai/schemastery` for config validation. Nothing else.
- **File access:** reads and writes exactly one JSON file —
  `garden.json` under the profile-owned `.mushroom-forest` directory (or an
  explicitly configured absolute `outputDir`). Writes go to a sibling temp file
  and are renamed into place, and the file holds only counters and two
  timestamps: no prompts, no tool output, no session content.
- **Command access:** none. The plugin spawns no processes.
- **Network and credentials:** no network request, no credential use.
- **Primary risks:** one small local file write per growth event. The plugin is
  purely additive — it never rewrites, suppresses, or judges a harness result.

## Install

```sh
PROFILE=tui
dsh plugin --profile "$PROFILE" add <package-spec>
dsh --profile "$PROFILE" --dump-config
```

The garden then lives at:

```text
$DSH_HOME/profiles/<profile>/.mushroom-forest/garden.json
```

To remove:

```sh
dsh plugin --profile "$PROFILE" remove -w dsh-mushroom-forest
```

## Config

Set in the profile's layer row (`cordis.patch.yml` ships these defaults):

| Key | Default | Meaning |
| --- | --- | --- |
| `mode` | `grow` | `disabled` mounts nothing — no listeners, no `/garden`. |
| `outputDir` | `null` | Absolute garden directory; `null` = profile-owned `.mushroom-forest`. |
| `growOn` | `turn+tool` | `turn`, `tool`, or `turn+tool` — which events may grow mushrooms. |
| `countBugs` | `true` | `false` keeps failures out of the garden entirely. |
| `maxGrowthPerSession` | `2000` | Per-session growth ceiling. |
| `awaitOnFlush` | `true` | Await the pending garden write on `session/flush`. |
| `commandName` | `garden` | The slash command name to register. |

## Failure and data boundary

The garden is a keepsake, not a ledger. An unreadable or corrupt `garden.json`
starts an empty garden rather than throwing, a failed write is swallowed, and no
growth failure can ever interrupt a turn. Losing a mushroom is fine; breaking
your session is not.

## Development

```sh
npm install
npm test          # node --test tests/*.test.js
npm pack --dry-run
```

## License

Apache-2.0.
