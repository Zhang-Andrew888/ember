# Crew log (feat/crew)

Running log for the crew increments. Newest last. (Each branch adds its own section; expect trivial add/add merges on this file.)

## Increment 3, reworked (feat/crew-3-autonomy-policy, from main)
- #13 was rejected: it keyed refusals/withdrawals to fatigue, injury risk and morale (contested vs SIMULATION.md line 90) and so depended on #10/#11. Reworked from main with none of that.
- `autonomy.ts`: pure `decideOrder` (accept/refuse) and `decideContinuation` (continue/withdraw) plus the announcement text. Triggers are only ones the spec already defines: direct observation closing the route, certifier failure, unreliable forecast, unsupported order kind, planner infeasibility.
- Behaviour-preserving: the controller now asks the policy, with the same reason codes and the same announcement wording as before. All pre-existing controller tests pass unchanged.
- Safety check caught in review of my own cut: a crew on its normal return phase must still withdraw when its route closes, so only withdrawing/retreating crews are exempt.
- return/hold/avoid/resume are always accepted: they only reduce exposure. Survival reasons are ordered: observation, certifier, forecast reliability.
