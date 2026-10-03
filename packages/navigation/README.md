# packages/navigation

Timed mission search, hazard certification, reservations, and retreat planning. Controllers in `@ember/agents` call into this package; they never bypass feasibility checks.

## Tuning vs learning

Mission ranking and `NavConfig` defaults come from [docs/NAVIGATION_AGENTS.md](../../docs/NAVIGATION_AGENTS.md). **Do not** train end-to-end policies on held-out seeds to chase win rates.

For exploration:

- **`NAV_CALIBRATION_PRESETS`** — small, named knob bundles (`calibration-grid.ts`).
- **`apps/server/src/nav-calibration-cli.ts`** — runs `ember_line` on development seeds and writes JSON summaries (same spirit as `sensitivity-cli.ts` for forecast priors).

Reinforcement learning is a poor fit here: runs must stay **deterministic and replayable**, every move must pass **certified mission search**, and product docs explicitly forbid tuning to headline outcomes. If you need “learning,” treat it as **offline calibration** on documented constants, then version any change you adopt.
