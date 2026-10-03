# Simulation and initial scenario

All numerical values below are chosen MVP defaults. They describe game behavior, not validated wildfire physics. They can be tuned in versioned configuration without reopening the product interview.

## Clock and defaults

| Parameter | Initial value |
|---|---|
| Real play limit | 300 seconds |
| Simulation rate | 5 simulated seconds per real second |
| Authoritative step | 1 simulated second, normally every 200 ms wall time |
| Incident horizon at timeout | 1,500 simulated seconds |
| Grid | 64 × 64 cells, 25 m each; 1.6 km square |
| Ground movement | 4 m per simulated second for all agents |
| Turnaround delay | 5 simulated seconds |
| Observation radius | 150 m, no occlusion |
| Observation sampling | Every authoritative step; publish changed observations |
| Stale label | More than 30 simulated seconds since observation |
| Crew work rate | 1 work unit per simulated second |
| Site required work | A: 300, B: 450, C: 600 units |
| Site values | A: 1, B: 1.5, C: 2 |
| Maximum damage reduction | 90% at full protection |
| Site destruction | Normalized accumulated damage reaches 1 |
| Unprotected damage rate | 0.006 per exposed simulated second |
| Site exposure radius | Any active burning cell center within 35 m |
| Base fire spread rate | 0.5 m per simulated second before modifiers |
| Private world spread multiplier | Seeded uniform sample in [0.6, 1.6] |
| Private wind shift time | Seeded uniform sample in [250, 650] simulated seconds |
| Wind travel direction | Initially east ±15 degrees; after shift, 45–100 degrees counterclockwise from east |
| Cell burn duration | 240 simulated seconds |
| Refuge nonburnable radius | 50 m around designated refuge nodes |
| Forecast defaults | See [navigation](NAVIGATION_AGENTS.md) |

All UI work windows and route ETAs are labeled as incident time; the main five-minute countdown is labeled real play time. Do not compare a wall-clock duration to a simulated route duration.

The server uses a monotonic clock to schedule fixed steps. Do not derive fire progression from rendering frame rate or provider response timing. At 300 real seconds, stop accepting commands and finalize the due simulation steps through tick 1,500. Significant processing backlog is reported as a technical failure; do not silently slow a run to extend user decision time.

## Scenario geography and assets

Use a locally packaged OpenStreetMap road extract from the Oakland hills around Montclair as the acquisition region. Select a connected 1.6 km patch containing a loop with two approaches, a junction suitable for a constrained segment, and branches for three sites. This is an acquisition decision; no extract or verified node IDs are included in this documentation delivery.

During the first build slice, export the graph, validate connectivity, then freeze node/edge IDs in a versioned scenario file. If the first crop lacks the required loop, shift the crop within the same region rather than inventing a road and calling it real. A synthetic graph fixture is acceptable for unit tests and the first technical spike, but the final demo requires the real extract.

Preserve source identifiers, source date, and attribution metadata. Display “© OpenStreetMap contributors” linked to the source copyright page. Package source/license information with the extract; do not depend on live map tiles during a run. [OpenStreetMap copyright and attribution](https://www.openstreetmap.org/copyright).

Road geometry is real; synthetic elevation, vegetation, narrow-road capacity, sites, refuges, and ignition must be explicitly labeled as authored. Use a smooth seeded terrain height field rather than a new live elevation dependency.

Fictional callsigns: Crew 1, Crew 2, Crew 3, Scout. Fictional sites: A — Ridge Cabins; B — Waterworks; C — Community Lodge. Two refuges are named Refuge West and Refuge South. Site names refer to authored markers, not claims about real buildings.

Scenario geometry acceptance constraints:

- Typical one-way refuge-to-site travel is 150–350 simulated seconds.
- Two meaningful approaches differ in travel time by at least 20%.
- The constrained segment has waiting space at both endpoints.
- At least two scouting points reveal different parts of a threatened corridor.
- Initial feasible missions exist; crews do not spend the whole run waiting.
- A wind shift can change a return decision before the work finishes.
- Refuge areas never burn in this scenario, and road entry can still become inaccessible.

Place agents at refuge nodes at start. Start a 2 × 2 burning patch in the upwind quadrant, at least 200 m from agents and sites and outside refuge protection areas. Freeze its cells when authoring the extracted graph's scenario. All agents receive the same limited initial observation of that patch and public map briefing, including nominal wind information but not the private shift parameters. Start with no active recipient. Crew choices may overlap; the coordinator can improve allocation with its broader picture.

## Fire evolution

Cells have nonburnable, unburned, burning, and burned states. Fuel and height are seeded scenario layers. A burning cell can ignite one of its eight neighbors by accumulating spread progress along that directed connection. A burned cell cannot reignite in this MVP.

For a burnable neighbor, use:

```text
rate = clamp(
  baseRate × spreadMultiplier × targetFuel
  × exp(0.6 × windAlignment + 1.5 × uphillSlope),
  0.1, 2.0
)
```

Wind alignment is the cosine of wind direction against the neighbor direction; uphill slope is rise/run clamped to [-0.5, 0.5]. Fuel is fixed in [0.6, 1.4]. Accumulate rate × step duration against the 25 m or diagonal cell distance. On ignition, start the cell burn timer. Extinguish a cell when its 240-second burn duration expires. Wind changes affect subsequent accumulated spread; do not reuse a static ignition-time field after a wind shift.

Use one initial burning patch and one seeded wind shift. No spotting, suppression, or reignition in the shipped first scenario. Keep random streams separate for world generation, forecasts, and optional cosmetic effects.

Truth parameters and the actual shift are private. Initial forecast assumptions deliberately span a plausible range and need not include the showcase's true shift. An earlier-than-expected shift can invalidate the ensemble; the planner must recover from observations rather than reading the true parameters.

This model is intentionally simple. Its acceptance criterion is reproducible timing and meaningful route changes, not correspondence with a real wildfire.

## Physical movement and losses

Road polylines map to crossed grid cells. An edge segment becomes physically closed when its cells ignite and stays closed for the rest of the incident, including after burnout. Initial authoring ensures intersections/refuges have sufficient capacity; only marked segments need single-agent reservations.

An agent moves continuously along its edge distance. Subdivide its traversed path for collision checks so it cannot jump across an active cell between endpoints. An agent whose position intersects an actively burning cell is lost on that step. No injury meter, rescue mission, or resurrection. A scout can be lost under the same rule, but its survival does not prevent the all-protection-crews-lost ending.

A newly encountered obstruction triggers local observation and replanning from the actual position. A crew may reverse with the modeled delay. Fire can still overtake it while it turns or retreats.

Loss cancels that agent's future reservations and removes its physical agent occupancy. The fire-closed road remains closed; a decorative wreck does not create a second persistent obstruction in the MVP. This terminal removal is distinct from ordinary reversal, which keeps occupancy until physical exit.

## Work and damage

Let W be required work and w completed work. Only living crews physically working at a site contribute:

```text
w_next = min(W, w + dt × sum(activeCrewWorkRates))
p = w_next / W
damageRate = exposed ? 0.006 × (1 - 0.9 × p) : 0
damage_next = min(1, damage + dt × damageRate)
```

Use the same documented tick ordering for all comparisons. Protection benefit persists after departure, damage is irreversible, and protection does not alter fire cells. Work stops at completion or destruction. A fully protected site can still receive residual damage while the incident continues.

When damage reaches 1, the site is destroyed and cannot be repaired. Completed work stays in the historical effort metric; a destroyed site never receives saved-property credit. Track completed protection and final destruction separately so a site completed earlier and destroyed later is not mislabeled as saved.

A site is resolved if protection is complete or it is destroyed. Actual resolution is available to end-condition evaluation; agent knowledge changes only through observation or delivered evidence.

## Observations and aging

Each living agent observes cell states and site progress/damage within 150 m, using distance to cell/site centers. It records source, footprint, observed simulated time, and receive time. Also report the agent's own position/action to the coordinator. Radius and sampling are identical for crew and scout.

Observations are exact for this simplified sensor model. Forecast fitting may have spatial tolerance, but a crew's direct positive observation of fire is never ignored because a model disagrees. Current local hazards block planned movement immediately.

Keep last-known states outside current visibility; stale labels do not erase history or turn it into present truth. A newer sighting of the same place supersedes its older current-state display while both remain in the event history. A fresh local sighting outranks an older coordinator relay. If equally timed reports conflict, retain the conflict and plan conservatively until resolved.

## Authoritative step order

1. Drain eligible validated commands in sequence; reject late/ended-run inputs.
2. Apply ready planning results only after current-state revalidation.
3. Advance wind and fire for the step.
4. Move agents along their committed trajectories and detect fire intersection along the movement interval. Resolve losses before counting work.
5. Apply work from surviving working crews, then site damage and destruction.
6. Sample observations, update scoped knowledge, and publish coordinator evidence.
7. Recheck cached mission feasibility at current time; trigger withdrawal/retreat before selecting optional new work. Queue forecast jobs as needed.
8. Update reservations and emit committed decisions.
9. Evaluate all ending conditions and persist the snapshot/events.

Collision checks include newly burning cells even for agents stationary at sites. This ordering is a conservative one-step model; do not award a lost crew an extra full tick of work.

## Ending and simultaneous outcomes

Normal endings are exactly: real-time expiry, zero burning cells, all sites resolved, or zero living protection crews. Record every condition true on the terminal step. Display precedence: all protection crews lost, all sites resolved, fire extinguished, time expired. This precedence changes presentation only; it cannot hide losses or destroyed sites.

Stop further simulation and commands immediately at the terminal step. No extra return phase or hidden continuation is counted in gameplay results. A run that ends with agents en route records those missions as interrupted by incident end, not as successful returns.

## Calibration procedure

Version all parameter changes. First tune travel/work durations to create at least two meaningful coordinator interventions in a typical five-minute run. Then tune spread and wind timing to produce useful alternative routes and occasional forecast recovery. Finally tune damage so partial protection affects outcomes.

Maintain one rehearsed showcase seed, at least five development seeds, and held-out evaluation seeds. Never tune to a target headline win rate. Geography extraction, seed selection, and measured performance are implementation deliverables, not already completed assets.
