# Crew log (feat/crew)

Running log for the crew increments. Newest last.

## Setup
- pnpm 12.8.1 shim from corepack was broken in the container; used `corepack prepare pnpm@10.34.6 --activate`.
- PR review at start: #4 closed unmerged but superseded by merged #6 (same head); #8 is the web lane's. No crew PRs yet.

## Increment 1: typed roles and capabilities (feat/crew-1-roles), reworked after review
- Review rejected the first version (engine / hand_crew kinds, fatigue, carrying capacity are not in the docs; new zod dependency not justified). Reworked to the subset the spec supports: per-role typed `speedMps` and `workRate` equal to the documented defaults (SIMULATION.md; NAVIGATION_AGENTS.md "the crew's own work rate"), over the existing wire roles. No new dependency, no behaviour change at defaults.
- The full first version is preserved on branch `feat/crew-1-roles-full` in case Andrew amends the spec to add crew kinds.
- Kinds engine / hand_crew, fatigue and carrying capacity need a spec change first (`docs/**` is human-authored); not resubmitted.
