# Crew log (feat/crew)

Running log for the crew increments. Newest last.

## Setup
- pnpm 12.8.1 shim from corepack was broken in the container; used `corepack prepare pnpm@10.34.6 --activate`.
- PR review at start: #4 closed unmerged but superseded by merged #6 (same head); #8 is the web lane's. No crew PRs yet.

## Increment 1: typed crew roles (feat/crew-1-roles)
- Kinds engine / hand_crew / scout live in packages/agents (crew-internal). Wire role stays `protection_crew | scout`; a wire-level kind would need a contract change, not opened because nothing crosses the wire yet.
- The simulator gives every agent the same speed and work rate, so `navConfigFor` caps planning speed/work rate at the simulator's values and never lowers the buffer: capabilities can only make planning more conservative.
- Added `zod` 3.24.2 (same pin as domain/simulation) to packages/agents to validate attributes; lockfile updated.
- Kind only changes planning when passed explicitly; default controllers behave exactly as before.
