# Contributing

Thanks for helping make AI's water footprint visible. This is a small, deliberately strict repo: the checks below are the contract.

## Prerequisites

- Node ≥ 22.18 (runs the core's `.ts` tests directly) and npm
- Claude Code (`claude` on PATH) for the band's tests and validation
- OpenCode ≥ 1.17, only for manual testing of the sidebar / tool

## Checks (run before every PR)

```bash
node --test tests/core.spec.ts            # the estimator, pinned to its golden values
claude plugin test .                      # the band, in Claude Code's own test kit
claude plugin validate .                  # manifest, marketplace and hooks module
npm install && npx tsc -p tsconfig.opencode.json
```

## Conventions

- **One estimator.** `core/` is the only place coefficients, the formula and formatting live; both hosts import it. Keep it pure: Claude Code runs the band with no Node, so `core/` may not import a runtime module (`node:*`, packages). Host-specific code (file paths, env) stays in the host's folder.
- **Explicit `.ts` extensions** on relative imports, so Node, Bun and Claude Code all resolve them.
- **Changing a number on purpose.** `tests/fixtures/golden.json` pins today's outputs. If you change a coefficient or the formatting deliberately, update the fixture in the same commit and say why.
- **Comments only when they carry information.** Explain *why* for magic numbers and external contracts; let the code explain *what*.
- **Label estimates as estimates.** Anything user-facing that shows a number should make clear it's an order-of-magnitude figure (the region span exists for exactly this).

## Where things live

| I want to… | Edit |
| --- | --- |
| Tune energy / water coefficients, add a region | `core/water.ts` (`ENERGY_WH_PER_KTOK`, `REGIONS`) |
| Change formatting / everyday equivalents | `core/water.ts` (`fmtWater`, `ANALOGIES`) |
| Change how transcripts are read | `core/transcript.ts` |
| Change the Claude Code band | `hooks/register.tsx` (state contract in `types/index.d.ts`) |
| Change the OpenCode sidebar / tool | `src/` |
| Add a host integration | a new folder beside `src/`, importing `./core` |

## Good first issues

- More region profiles, each with a cited source.
- A cited source for the cache-read energy factor (`CACHE_READ_FACTOR`), which drives most of a long session's total.

## Commits & PRs

- One logical change per commit; imperative subject (e.g. `add asia region profile`).
- Run the checks above and note in the PR which ones you ran.
- For new coefficients or data, cite the source (paper, report, or measurement).
