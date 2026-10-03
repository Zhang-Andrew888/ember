# Navigation and autonomous agents

## Planning defaults

| Parameter | Initial choice |
|---|---|
| Forecast members | 24, including predefined boundary cases |
| Forecast horizon | 1,800 simulated seconds from current time |
| Mission safety buffer | 30 simulated seconds |
| Time-search resolution | 5 simulated seconds, rounded conservatively |
| Work interval candidates | 15 seconds minimum; 30-second increments plus exact remaining-work endpoint |
| Normal forecast refresh | Every 25 simulated seconds or relevant new evidence |
| Local hazard checks | Every authoritative step |
| Reservation guard gap | 5 simulated seconds |
| Optional mission switching | At least 20% better score; 30 simulated seconds between discretionary switches |
| Emergency/objective response | Immediately on the next eligible tick; no discretionary cooldown |
| Rebuild attempts | Up to three widening rounds per new contradictory evidence set |

These values are configuration defaults to benchmark and tune. They are not probabilities of safety or guarantees of optimal navigation.

## Per-agent input boundary

A planner receives public map/briefing, that agent's observations and delivered evidence, own position/state/objective, and limited reservation availability. It never receives the world seed, actual remote fire, another agent's private knowledge, or the coordinator's aggregate transcript.

The coordinator has its own forecast over its broader received evidence. It is used for display and human decisions, not as a shared agent forecast. Cache reuse is keyed by the full scoped input hash.

Shared initial information includes site identities and initial progress, not future progress. Co-located crews see current site work through their local observations. A crew that knows only its own work uses that contribution for completion-time estimates; it does not assume an unseen crew will arrive or remain.

## Fire forecasts

Use the same simplified spread mechanism as the simulator, driven by separately sampled hypotheses. Each member has candidate spread multiplier, initial-front uncertainty, wind direction, shift time, and post-shift direction. Begin with multiplier 0.7–1.3, wind uncertainty ±30 degrees, and shift time 450–650 simulated seconds. Include extrema and some no-shift cases. The true world is sampled separately and may lie outside this set.

Store per-cell first ignition times and current/burned state for each member. An unseen location is unknown, not automatically clear. Generate its plausible state from the public prior and received observations. Once a road cell is known burned/closed, treat it as closed for the rest of the incident.

On new evidence, synchronously filter cached predictions and apply direct observed closures before committing further movement. While a refreshed rollout is pending, an existing plan may continue only if the supported cached predictions plus new direct constraints still certify it. Otherwise stop work and begin the appropriate survival response. New plans wait for a current, supported forecast; a background job is not permission to use a known-invalid certificate.

Compare predicted observations at the actual observation timestamp. Do not treat an old “clear” report as current clearance. Retain members whose visible-state disagreement is at most 10% across the observed footprint and whose observed burning front is within one cell of prediction. Exact newly observed hazards still constrain routing immediately, regardless of this model-fitting tolerance. Tolerance is a calibration constant; test its sensitivity.

Keep all retained boundary cases. Retention is driven only by evidence and prior plausibility, never by whether a desired task succeeds. If fewer than 24 supported members remain, use seeded perturbations to replenish, retaining supported extremes. Permit up to 32 members when required to preserve those extremes. Do not remove a dangerous member to meet a runtime target.

An ensemble is a finite design approximation. The fraction of members passing a check is not a validated survival probability.

## Contradiction and rebuilding

Before incorporating a contradictory observation, test it against the previously retained predictions. If every member fails, set that decision-maker's reliability to UNRELIABLE and emit an explanation.

Broaden spread-rate bounds and wind-direction/shift-time bounds around the prior, including earlier shifts. Generate candidates from public initial conditions and that decision-maker's full received observation history, replay them forward, and test their fit. Do not initialize from the actual hidden grid. Use deterministic samples from a forecast-only random stream.

Widen by factors 2, 4, and 8 relative to the initial uncertainty ranges, within configured physical bounds of the game model. Preserve already observed burn history and sample unobserved state. Require at least eight distinct supported candidates, including supported extrema, before returning to RELIABLE; otherwise remain UNRELIABLE. New evidence can initiate another bounded rebuild. Store parameter ranges and observation IDs in the rebuild event.

While unreliable, admit no new protection mission. Stop ongoing protection and attempt withdrawal using directly observed closures, retained conservative information, and emergency retreat rules. Forecast work is asynchronous; a pending rebuild never pauses the crew or incident.

## Complete mission search

A normal mission is one concrete timed approach, work interval, and return to a refuge. The same route/timing must pass every retained scenario. Do not pick a different route per scenario and claim the combined mission is feasible.

For each site permitted by the current objective:

1. Start from the actual edge position or node; add virtual connections to both edge endpoints with physical travel and turnaround costs.
2. Search a time-expanded road graph with conservative 5-second time buckets, refuge waiting, and reservation availability.
3. Generate alternative approach arrivals; evaluate useful work intervals up to the known remaining work.
4. Search a timed return to each designated refuge after the chosen work interval.
5. Check every crossed road cell, waiting position, and work-site position through the relevant time interval.
6. Negotiate the required reservations, then recheck the complete mission with committed timing.
7. Rank only admitted missions.

For each occupied location x and time t, require t + buffer < firstIgnitionTime(member, x) for every retained member. Known closed roads fail immediately. Sample the full road polyline through crossed cells, not just junctions. A horizon boundary means insufficient forecast support; shorten or reject the mission instead of assuming safety beyond it.

Time-expanded search includes explicit waits only at suitable nodes. Default to no waiting mid-edge except forced emergency stops. Precomputed geometric routes can seed search but cannot be the only alternatives when their timing fails. Bound search by the forecast horizon and document “no feasible mission found in this model” rather than claiming no possible real route exists.

Return feasibility remains required even if work might finish every site and end the game before the return is executed. This preserves the accepted full-mission planning rule.

## Mission ranking and objectives

First filter by life-preservation and reservation requirements. Then score admitted protection missions:

```text
score = siteValue × estimatedAdditionalProtectionFraction
        / max(1, approachTime + workTime + returnTime + waitingTime)
```

Estimate contribution using the crew's own work rate and known remaining work. Use local evidence to avoid already resolved tasks. Resolve ties by earlier completion, then stable site ID and route ID. Do not reward accepting extra risk.

Feasible coordinator objectives restrict the candidate set and take precedence over autonomous score. Supported objective kinds: protect a named site, observe a named corridor/point (scout), return to a refuge, hold at a refuge, avoid a corridor, and resume autonomous selection. Each is still checked for feasibility.

A new infeasible objective is rejected once with a concrete reason and does not erase an existing feasible plan. A successful replacement invalidates obsolete future reservations atomically. If an accepted objective later becomes unsafe, survival action takes precedence; explain suspension. After reaching refuge, reassess it once. If it still fails, reject that revision and resume feasible independent selection. A coordinator hold/return direction persists until satisfied or replaced.

Use switching hysteresis only for optional autonomous improvement. A coordinator revision or survival trigger bypasses it. This prevents crews from oscillating between nearly equal sites without delaying urgent action.

## Agent states

| State | Behavior and exits |
|---|---|
| HOLDING | At refuge; choose feasible work or remain under hold objective |
| PLANNING | Existing feasible execution continues; no unvalidated new movement |
| APPROACHING | Follow committed timed route; observe and recheck |
| WORKING | Contribute while site unresolved and return remains feasible |
| RETURNING | Planned work interval ended or task resolved; return normally |
| WITHDRAWING | Earlier departure because continued work fails; urgent report |
| RETREATING | No normal return passes; minimize estimated exposure |
| STRANDED | No known passable route; observe, report, and reconsider on changes |
| LOST | Terminal agent state; no movement, work, or observations |

Clarification is a pending communication state, not a physical pause state. After a normal return from partial work, select another feasible mission. No feasible work means hold and reassess after evidence or changed availability; it does not by itself end the incident.

## Retreat

If a forecast-feasible immediate return exists, take it. If none exists, stop protection work and search known physically passable alternatives using lexicographic preference: avoid directly observed burning/closed cells; minimize estimated integrated exposure across available hypotheses; then minimize travel time to refuge.

A route may still fail normal forecast constraints. Label it best-effort retreat and record a return-plan failure independently of eventual survival. With an unreliable forecast, use broadened provisional candidates and direct observations to rank emergency options, but never label that ranking normal admission.

If no known passable option exists, remain STRANDED, maintain observations, and announce the reason. Fresh evidence can reopen a planning option; no random wandering into an observed lethal cell. The hidden simulation may still overtake the crew.

## Automatic road reservations

Single-capacity segments require timed occupancy reservations in either direction, including a guard gap. Normal multi-lane segments need no shared-capacity scheduler in this MVP.

Priority: physical occupant first; then emergency retreat/withdrawal, normal return, approach, scouting travel. Within a class choose earlier requested entry, then stable agent ID. An occupied segment cannot be preempted. An unoccupied future reservation can be moved only after the affected agent verifies its own revised complete mission or emergency alternative.

The reservation service asks each affected controller whether a proposed yield is feasible; it does not read that controller's fire forecast. Other agents receive allocated windows or unavailable slots, not the other agent's observations or complete task plan.

If both agents cannot safely yield, do not invent a feasible schedule. Keep physical occupancy exclusive, ask the controllers to seek alternatives, and surface the conflict as a planning failure. No circular wait is allowed to become an accepted normal mission. Replan from the actual position.

Reversing agents retain occupancy during turnaround and return travel. Update their actual expected exit time and invalidate conflicting future allocations. Existing occupancy cannot be shortened by merely editing a route.

## Ground scout

Choose among three authored reachable observation points. The scout shares ground movement, observation radius, forecast admission, withdrawal, and loss rules. Its work interval is a 10-second observation dwell; it does not protect sites.

Rank feasible scout missions by forecast disagreement about corridor closure at a relevant time, multiplied by public site-access importance, divided by total travel/dwell/return time. When the coordinator relays a crew mission or decision deadline, use that evidence to improve relevance. Do not silently read other crews' assignments.

Avoid repeatedly visiting an unchanged recently observed point; use a 60-simulated-second revisit cooldown unless new evidence or a coordinator objective justifies it. Observation still happens continuously during travel. New findings update the coordinator immediately; speech is reserved for meaningful changes.

## Explanation format

Emit structured decisions with reason codes, supporting observation IDs, old/new plan IDs, and the limiting constraint. Build a short human sentence from those values.

Examples: “Crew 2 is withdrawing. Our last eastern-road observation shortened the return window.” “Crew 1 cannot reach the lodge and return with the required margin.” “Scout is taking the west loop to check the unresolved fire edge.”

Do not turn the actor into a passive approval prompt. Explain what it has done, what it knows, and the resulting estimate.
