# Crew log (feat/crew)

Running log for the crew increments. Newest last.

## Setup
- pnpm 12.8.1 shim from corepack was broken in the container; used `corepack prepare pnpm@10.34.6 --activate`.
- PR review at start: #4 closed unmerged but superseded by merged #6 (same head); #8 is the web lane's. No crew PRs yet.

## Increment 1: typed roles and capabilities (feat/crew-1-roles), reworked after review
- Review rejected the first version (engine / hand_crew kinds, fatigue, carrying capacity are not in the docs; new zod dependency not justified). Reworked to the subset the spec supports: per-role typed `speedMps` and `workRate` equal to the documented defaults (SIMULATION.md; NAVIGATION_AGENTS.md "the crew's own work rate"), over the existing wire roles. No new dependency, no behaviour change at defaults.
- The full first version is preserved on branch `feat/crew-1-roles-full` in case Andrew amends the spec to add crew kinds.
- Kinds engine / hand_crew, fatigue and carrying capacity need a spec change first (`docs/**` is human-authored); not resubmitted.
Running log for the crew increments. Newest last. (Each branch adds its own section; expect trivial add/add merges on this file.)

## Increment 3, reworked (feat/crew-3-autonomy-policy, from main)
- #13 was rejected: it keyed refusals/withdrawals to fatigue, injury risk and morale (contested vs SIMULATION.md line 90) and so depended on #10/#11. Reworked from main with none of that.
- `autonomy.ts`: pure `decideOrder` (accept/refuse) and `decideContinuation` (continue/withdraw) plus the announcement text. Triggers are only ones the spec already defines: direct observation closing the route, certifier failure, unreliable forecast, unsupported order kind, planner infeasibility.
- Behaviour-preserving: the controller now asks the policy, with the same reason codes and the same announcement wording as before. All pre-existing controller tests pass unchanged.
- Safety check caught in review of my own cut: a crew on its normal return phase must still withdraw when its route closes, so only withdrawing/retreating crews are exempt.
- return/hold/avoid/resume are always accepted: they only reduce exposure. Survival reasons are ordered: observation, certifier, forecast reliability.

## Increment 6: callsigns and communication style (feat/crew-6-callsigns, from main)
- `callsigns.ts`: `CallsignDirectory.resolve` is total (match / ambiguous / unknown, never throws) and deterministic regardless of directory order. Normalizes case, punctuation and number words ("Crew-Two" = "crew 2"); strips spoken filler ("the", "please"). Exact normalized match wins, else all heard tokens must appear in a callsign. Crew 1 never matches Crew 10. Identical callsigns are always ambiguous. `clarification()` gives the question to ask.
- `defaultCallsign` derives the documented fictional callsigns (Crew N, Scout) from authored ids.
- `style.ts`: `plain` (default) or `radio` (callsign-first, shorter opening). Never changes the reason or uncertainty; test pins that the reason text is kept verbatim.
- `ControllerOptions.style` per crew; the stored last report is the styled text, i.e. what was actually said.
- The communication package already resolves explicit names itself (matchName); I did not touch it (out of lane). This directory is the crew-side source of truth callers can adopt.
