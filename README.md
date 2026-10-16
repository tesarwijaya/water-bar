# water-bar

Estimate the water consumed by AI inference from token usage, and show it live inside your coding agent.

Every Claude Code / OpenCode session draws water: data centers evaporate it for cooling, and power plants consume it to generate the electricity your tokens run on. This repo turns token counts into a water estimate (mL / L), renders a relatable everyday equivalent (cups of coffee, bottles, showers), and surfaces it in a **Claude Code band above the prompt** and the **OpenCode sidebar**. Both run the same TypeScript estimator (`core/`); there is nothing else to install.

> All figures are **order-of-magnitude estimates, not measurements**. See [Caveats](#caveats).

## What you get

- **Claude Code band** (`water-bar`, a Claude Code mod): a band above the prompt with the session's water (on-site / off-site split and region range), model, context-window use and cost, plus a region picker.
- **OpenCode sidebar section**: a live `Water Usage` block in the sidebar (`9.8 L water ≈ 20 bottles`), right under the built-in `Context` section.
- **OpenCode `water_bar` tool**: the agent can report the session's water on demand.

## How it estimates

Everything reduces to the same two-step pipeline:

```
tokens ──▶ energy (kWh) ──▶ water (L)
```

This repo implements the **two-phase, scope-split model (Model 2)**:

```
Water [L] = E_IT × ( WUE_site + PUE × EWIF_grid )
```

| Term | Meaning |
| --- | --- |
| `E_IT` | Inference energy from tokens (kWh) |
| `WUE_site` | On-site cooling water per IT kWh (scope-1) |
| `PUE` | Power usage effectiveness (facility overhead) |
| `EWIF_grid` | Grid water intensity per kWh (scope-2) |

`E_IT` charges token buckets at different rates, because decode is far more energy-hungry than prefill:

- **input** tokens → prefill rate
- **output + reasoning** tokens → decode rate (~5–7× prefill)
- **cache-write** tokens → full prefill rate
- **cache-read** tokens → ~10% of prefill (memory hit, not compute)

The off-site grid term usually dominates (~80% of the total), so **region matters more than the model**. A session that switches models is charged each model's own rate.

### Regions

| Region | `WUE_site` (L/kWh) | `PUE` | `EWIF_grid` (L/kWh) |
| --- | --- | --- | --- |
| `us` | 0.30 | 1.15 | 4.5 |
| `eu` | 0.30 | 1.15 | 2.0 |
| `asia` | 0.50 | 1.25 | 3.5 |
| `global` | 0.40 | 1.20 | 4.0 |
| `renewable` | 0.30 | 1.10 | 0.05 |

Coefficients are synthesised from public work including UC Riverside's *"Making AI Less Thirsty"*, Jegham et al. 2025 (*"How Hungry is AI?"*), Google's Gemini disclosure, and Siddik et al. 2021 (US grid water intensity). They are estimates, not measurements.

### Everyday equivalents

The sidebar and the band pick the daily-life unit whose count lands closest to ~20, so it always reads naturally:

| Water | Reads as |
| --- | --- |
| 2 mL | 40 drops |
| 30 mL | 6 teaspoons |
| 100 mL | 20 teaspoons |
| 4.9 L | 20 cups of coffee |
| 9.8 L | 20 bottles |
| 500 L | 7.7 showers |

Unit ladder: `drop → teaspoon → cup of coffee → bottle → toilet flush → shower → bath`.

## Repository layout

```
water-bar/                 # the repo root is the plugin root for BOTH hosts
├── core/                     # the estimator, shared by both hosts (pure TypeScript, no runtime imports)
│   ├── water.ts              #   coefficients, Model 2 math, mL/L formatting, everyday equivalents
│   └── transcript.ts         #   Claude Code JSONL parser (backfill only)
├── package.json              # OpenCode plugin manifest (`main` → ./src/index.ts)
├── src/                      # OpenCode plugin: `water_bar` tool + sidebar section (imports ./core)
│   ├── index.ts              #   the `water_bar` tool
│   ├── tui.tsx               #   the sidebar section
│   └── region.ts             #   shared region resolution (reads the file the band writes)
├── .claude-plugin/           # this repo is both a Claude Code marketplace and the water-bar plugin
│   ├── marketplace.json
│   └── plugin.json
├── hooks/register.tsx        # the water-bar band (Claude Code mod)
├── types/index.d.ts          # the band's state contract
├── tests/                    # core.spec.ts (Node), water-bar.test.tsx (Claude Code test kit)
├── install-claude.sh         # one-step Claude Code install
└── install-opencode.sh       # one-step OpenCode install
```

## Install — OpenCode

Requires OpenCode ≥ 1.17.

### OpenCode v1 (≤ 1.19)

Install from a local checkout — on v1 the sidebar only renders for a `file://` plugin:

```bash
git clone https://github.com/tesarwijaya/water-bar.git
cd water-bar
./install-opencode.sh
```

The installer is idempotent: it points both config files at the checkout (`file://…/water-bar`) and ensures the `@opencode-ai/plugin` dependency in `~/.config/opencode/package.json`. Then **restart OpenCode**; the `Water Usage` section appears under `Context` whenever a session is open.

> **Don't install v1 from GitHub.** A `github:`/npm spec (`{ "plugin": ["github:tesarwijaya/water-bar"] }`) loads the `water_bar` **tool** but not the sidebar: OpenCode installs package TUI plugins under `node_modules`, where their `@opentui/solid` import resolves to a separate renderer instance (opencode#33885), so the panel silently never shows. The local checkout sidesteps it.

### OpenCode v2

Install straight from GitHub — the CLI clones the repo and patches both config files:

```bash
opencode plugin add github:tesarwijaya/water-bar
```

Or add the spec by hand:

```jsonc
// in both opencode.json(c) and tui.json
{ "plugin": ["github:tesarwijaya/water-bar"] }
```

Override the config directory with `OPENCODE_CONFIG_DIR=/path/to/config` if needed.

## Install — Claude Code

Requires Claude Code with the `claude` command on PATH. Tested on Claude Code 2.1.299.

Install from GitHub — the repo is a marketplace, so no checkout is needed:

```bash
claude plugin marketplace add tesarwijaya/water-bar
claude plugin install water-bar@water-bar
```

Or, from inside a Claude Code session:

```
/plugin marketplace add tesarwijaya/water-bar
/plugin install water-bar@water-bar
```

Then start a new session (or run `/reload-plugins` in an open one). An install from GitHub runs a copy of the repo, so it picks up new commits with `claude plugin update water-bar@water-bar`, not `/reload-plugins`.

Check it with `claude plugin list`: `water-bar@water-bar` should be `✔ enabled`.

<details>
<summary>Installing from a local checkout instead</summary>

```bash
cd water-bar          # a local checkout; keep it where it is (see Gotchas)
./install-claude.sh
```

What the installer runs (safe to re-run):

| Case | Command | What changes |
| --- | --- | --- |
| First install | `claude plugin install water-bar --marketplace <this checkout> --scope user` | `~/.claude/settings.json` gains `extraKnownMarketplaces.water-bar` (a `directory` source pointing at this checkout) and `enabledPlugins["water-bar@water-bar"]` |
| Re-run | `claude plugin marketplace update water-bar` then `claude plugin update water-bar@water-bar --scope user` | re-registers the plugin from this checkout |

`claude plugin list` then shows `water-bar@water-bar` as `✔ enabled`, `Read from:` this checkout.

</details>

The band above the prompt:

```
💧 Water Usage: 3.06 L ≈ 13 cups of coffee (on-site 235 mL, off-site 2.82 L, range 209 mL – 3.22 L) · claude-opus-5-5 · ctx 42% · $3.46  [ Region: global ]
```

- **Water** is computed in the band from the token counts Claude Code reports for each turn: the API's exact figures, subagent turns and compaction calls included. The totals are kept per session in the plugin's store, so they survive restarts and resumes.
- **Model, context % and cost** come from Claude Code itself (cost is Claude Code's estimate at list price and resets with `/clear`).
- **Region** (`r`) cycles the region. The choice is saved to `~/.config/water-bar/region`, which the OpenCode plugin reads too.
- Collapse the band with its `[-]` mark or ctrl+x ctrl+a; focus it with ctrl+x tab (or a click) to use the `r` hotkey.

### Gotchas

- **Keep a local checkout where it is** (only if you installed from one). A folder marketplace runs the band straight from that folder, so moving or deleting it breaks the band. After pulling changes, run `/reload-plugins` (and `./install-claude.sh` when the version in `.claude-plugin/plugin.json` changed). A GitHub install copies the repo and is unaffected.
- **Switching install source starts a fresh count.** Claude Code keeps a plugin's store per install, so moving from a local checkout to the GitHub install (or back) starts the band's totals over. Open sessions are then read back from their transcripts, subject to the 4 MiB limit below.
- **When it updates.** After each turn, not while Claude is replying. In a new session the water figure appears after the first reply; until then the band shows model, context and cost only.
- **Sessions older than the band.** A session begun before the band was installed (or resumed from another machine) is read back from its transcript once. Claude Code lets a plugin read at most 4 MiB at a time, so a longer transcript cannot be read back: the band then counts from that point on and shows the total as a lower bound (`≥ 1.20 L`). Backfill reads the main transcript only, so earlier subagent work is not included.
- **Organizations with managed settings.** Where an organization manages Claude Code, installed plugins do not receive compaction events, so compaction calls go uncounted (`claude plugin validate .` says so). Turns are counted either way.
- **Where it shows.** The band is drawn on the terminal and the desktop app only, not in the VS Code / JetBrains extensions.
- **`$WATER_REGION` beats the picker.** If it is set in the environment Claude Code starts from, pressing `r` cannot change the region; the band says so.
- **Developing the band.** `claude --plugin-dir .` hot-reloads edits, but disable the installed copy first (`claude plugin disable water-bar@water-bar`) so two copies don't run.
- **Early-access API.** The band is a Claude Code mod (function hooks), an API that may change between Claude Code releases. If the band disappears after an update, run `claude plugin validate .`.
- **Privacy.** Everything runs locally and nothing is sent anywhere. The plugin's store holds, per session id, token counts and model ids only, never conversation text. A backfill reads only the `usage` and `model` fields of the transcript.

### Uninstall

```bash
claude plugin uninstall water-bar@water-bar
claude plugin marketplace remove water-bar
rm -rf ~/.config/water-bar     # saved region (shared with OpenCode)
```

## Configuration

| Variable | Used by | Default | Purpose |
| --- | --- | --- | --- |
| `WATER_REGION` | both | the saved region, else `global` | Serving region (`us`, `eu`, `asia`, `global`, `renewable`), the dominant term. Overrides the picker |
| `WATER_CONFIG_DIR` | both | `$XDG_CONFIG_HOME/water-bar` or `~/.config/water-bar` | Where the picker saves the region |

## Development

```bash
node --test tests/core.spec.ts            # the estimator (Node ≥ 22.18 runs .ts directly)
claude plugin test .                      # the band, in Claude Code's own test kit
claude plugin validate .                  # manifest, marketplace and hooks module
npm install && npx tsc -p tsconfig.opencode.json
```

`tests/fixtures/golden.json` holds the golden values the core tests pin the estimator to. If you change a coefficient or the formatting deliberately, update it in the same commit.

## Caveats

- **Estimates, not measurements.** Every result carries a region span; treat it as an order of magnitude.
- **Region is the biggest lever.** The default `global` is a rough average; pick a region for a real number.
- **The cache-read factor matters.** Long agent sessions are mostly cache reads, charged at 10% of prefill energy; that factor drives most of a Claude Code total.
- **Claude Code transcripts** (read only for a backfill) repeat the same `usage` on every content-block line of one API response, so usage is deduplicated by `message.id`. They also write `output_tokens` as a mid-stream snapshot, so a backfill slightly undercounts output. The format is internal to Claude Code and may change.
- The single biggest modeling fact: **off-site grid water (~80%) usually dwarfs on-site cooling**, so *where and when* a model runs matters more than which model it is.

## License

MIT, see [LICENSE](LICENSE).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).
