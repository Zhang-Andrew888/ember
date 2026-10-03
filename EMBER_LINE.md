# Ember Line
## Navigate into a changing wildfire—and keep a way out

Ember Line is an active, five-minute simulation in which a human incident coordinator helps three autonomous protection crews and one ground scout respond to a changing synthetic wildfire. The coordinator communicates through free text and Grok push-to-talk voice. A polished Three.js map makes observations, uncertainty, crew decisions, and consequences legible.

This is a simulated navigation prototype, not an operational dispatch product. Roads come from a small real map extract; the fire, weather, structures, capabilities, and outcomes are authored simulation content.

## Product decisions

The user fixed the behavior below during the interview and delegated remaining navigation, agent, modeling, and implementation decisions. The technical documents contain those selected defaults.

| Area | Decision |
|---|---|
| Play length | At most five minutes of real elapsed play |
| Team | Three protection crews and one ground scout |
| Work | Three fixed structure-protection sites; multiple crews may work together |
| Control | One conversation, one addressed agent at a time; no map commands |
| Frontend | Three.js incident GUI with readable DOM communication controls |
| Voice | Grok push-to-talk input and spoken reports |
| Autonomy | Agents select and execute plans independently, including withdrawal |
| Authority | Feasible coordinator objectives take precedence; crews reject infeasible ones |
| Information | Broader but incomplete coordinator picture; separate knowledge for each agent |
| Evidence | Unsupported coordinator claims cannot establish safe conditions |
| Work model | Add work rates; retain progress; linear protection benefit |
| Damage | Accumulates under fire exposure; protection reduces the rate and does not repair |
| Loss | A crew overtaken by active fire is permanently lost for that incident |
| End | Time expires, fire extinguishes, all sites resolve, or every protection crew is lost |

## The playable loop

1. Read a short briefing before starting. Roads, site names, crew capabilities, refuges, and a limited initial fire report are available.
2. Start the incident. Crews independently select feasible missions; the scout investigates information gaps.
3. Local observations automatically update the coordinator's picture. Other agents receive them only through targeted updates.
4. Address an agent by name, relay evidence, ask for status, or revise its objective.
5. The recipient evaluates the update using its own knowledge and current position. It accepts, rejects with a reason, or asks a concise clarification.
6. Watch routes, work windows, protection progress, and forecasts change. Agents withdraw without permission when needed.
7. The first ending condition stops the simulation and opens an outcome summary and replay.

The incident keeps running while the coordinator reads, types, speaks, listens, or clarifies. No automatic pause or live speed control. A disconnected browser does not stop the server clock; reconnect restores the current view.

## Knowledge and agency

The coordinator sees crew/scout observations, reports, telemetry, and a separately identified forecast. It does not see the complete actual fire during active play. Each agent knows the common briefing, its own observations, targeted coordinator updates, its own state, and narrow road-reservation information.

A crew's independent choice is an executable plan. The coordinator can replace it with a feasible objective, including mid-mission. The crew chooses routes and timing; the coordinator cannot override its modeled survival constraints.

Agents observe fire and local site conditions within a fixed radius. There is no terrain occlusion in the MVP. Outside that radius, information remains timestamped last-known data. New local observations flow immediately to the coordinator, independently of spoken playback. Incoming reports do not broadcast knowledge to other agents.

“The eastern road is clear” is not accepted as fact merely because the coordinator says it. Relayed observations carry their source and time. Unsupported claims do not remove hazards, invalidate contrary observations, or make an otherwise infeasible mission acceptable. Precautionary instructions such as “avoid the east corridor” remain valid constraints when feasible.

A crew that cannot interpret an objective asks for clarification while continuing its existing feasible plan. A crew that understands an infeasible objective rejects that version and explains the limiting condition. Forecast estimates are never phrased as guarantees.

## Navigation and survival

A mission includes an approach, a useful work interval, and a return to a designated refuge. Partial-protection missions are valid. The same timed mission must pass every retained plausible forecast scenario with a time buffer, including travel, work, reservation waits, and turnaround time.

A changed forecast can shorten the work interval or change the route. If continuing work breaks return feasibility but immediate return passes, the crew automatically withdraws and prominently explains why. If no normal return passes, it stops protection work and attempts the least-exposure retreat it can find from its available knowledge. If it knows no passable way out, it reports being stranded and continues looking as observations or updates arrive.

Ground agents can reverse from their actual position on an edge, with physical travel and turnaround delay. They cannot teleport to a junction or release a road they still occupy. Reservations handle traffic automatically; withdrawal priority cannot force another crew into an infeasible wait.

If new observations contradict all retained forecasts, mark that decision-maker's forecast unreliable and rebuild a broader ensemble. An empty ensemble never passes admission. During recovery, no new protection mission is admitted and affected agents preserve their escape. No agent silently inherits another agent's forecast.

## Structure protection

Crews at the same site add their active work rates directly toward one progress total, capped at completion. Joining or leaving changes the rate without resetting progress. Later crews resume retained work. A scout contributes no protection work.

Protection benefit is linear in progress: half-complete protection gives half the maximum damage reduction. Damage accumulates while a site is exposed to the actual fire. Protection reduces further damage; it does not undo prior loss and does not alter fire spread.

Destroyed sites cannot receive useful protection. Crews learn remote destruction through the established observation/update paths. A site is resolved when protection is complete or the site is destroyed. Keep these outcomes distinct.

After a partial mission returns, the crew selects another feasible mission if unresolved work remains. If nothing currently passes its checks, it holds at refuge and reassesses; an empty assignment queue is not an ending condition.

## Conversation and audio

The last explicitly addressed crew or scout remains the active recipient until the coordinator explicitly switches. Display that recipient next to the text and push-to-talk controls. Incoming reports and map inspection never change it. An absent, ambiguous, or multiple recipient request is clarified before delivery.

During routine playback, urgent withdrawal/distress reports interrupt speech and appear prominently in the transcript. During push-to-talk capture, show the urgent call immediately but preserve the user's recording. Start its audio as soon as the user releases and audio is available, before routine replies. The spoken message retains its intended recipient. Agent action never waits for synthesis or playback.

Clear requests execute without confirmation. Typed and spoken inputs pass through the same validation and knowledge rules. Radio style changes phrasing, not authority or behavior. Audio-only failure leaves text interaction available and visibly marks speech unavailable. A complete provider outage can also prevent new language interpretation; existing agent behavior and incident status continue, with failed inputs shown explicitly.

## End conditions

Stop immediately when any of the following holds:

- Five minutes of real-time play have elapsed.
- No active burning cells remain in the actual simulated world.
- Every site is protection-complete or destroyed.
- Every protection crew is lost, even if the scout survives.

There is no mandatory return phase before the ending. Keep actual positions, losses, damage, and completed work in the results. A surviving crew outside refuge is not counted as having returned. Destroyed sites are failures even when their resolution ends the run. Record all simultaneous reasons; display precedence is defined in the simulation spec.

## Visual experience

Use a tilted, readable Three.js terrain scene with named corridors, clear crew silhouettes, site status, and distinct observed-versus-forecast fire layers. A persistent conversation panel, active-recipient label, and urgent-call strip anchor interaction. Camera controls and inspection are allowed; issuing an objective by clicking or dragging on the map is outside scope.

Information age and forecast reliability are visible. A full hidden-fire view is available only after the incident in explicitly labeled replay/debug mode. Rendering hidden fire behind a translucent overlay is not acceptable information isolation.

## Definition of done

- A complete five-minute-capable incident runs with the four ending rules.
- Three crews and a ground scout act autonomously with separate knowledge.
- A scout report can change a crew's plan only after a targeted coordinator relay.
- Text and Grok push-to-talk both deliver objectives, evidence, status requests, and clarification.
- Withdrawal, rejection, retreat, crew loss, and partial protection are visible and reproducible.
- Urgent audio follows the agreed capture/release and routine-interruption policy.
- Three.js provides the finished GUI, not a placeholder for a later visual pass.
- A real road extract is packaged locally; the final demo does not depend on live map retrieval.
- Replay reproduces recorded simulation actions and decisions; comparison results identify their coordination policy.
- Required checks in [validation](docs/VALIDATION.md) pass. No performance or survival improvement is claimed without measurements.

## Scope discipline

The first scenario has one ignition, one possible wind shift, a fixed observation radius, homogeneous ground movement, three fixed sites, two refuges, and one deliberately constrained road. No suppression that changes spread, off-road travel, refills, rescue tasks, agent resurrection, multiplayer, or live emergency-data feed.

Shrink terrain detail and candidate counts before cutting per-agent knowledge, full mission feasibility, voice, or the Three.js interface. Reduce forecast spatial resolution by changing the scenario version and revalidating; do not silently drop dangerous scenarios to make a mission pass.

See [implementation plan](docs/IMPLEMENTATION_PLAN.md) for the build sequence and [validation](docs/VALIDATION.md) for the two-minute presentation. All remaining parameter choices are assigned initial values in the technical documents; tuning them does not require another interview.
