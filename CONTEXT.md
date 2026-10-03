# Ember Line

Ember Line plans crew missions through a changing simulated wildfire. Its language distinguishes the work crews undertake, the journeys that make that work possible, and what the planner knows about the incident.

## Language

**Incident coordinator**:
The human participant who oversees the incident using a broader but incomplete picture assembled from crew and scout reports, and whose objectives take precedence when the receiving crew judges execution feasible.
_Avoid_: Organizer or overseer when referring to this role; use incident coordinator consistently.

**Incident picture**:
The coordinator's incomplete understanding of current incident conditions, automatically updated from crew and scout observations and supplemented by their reports.
_Avoid_: Ground truth or complete fire map when referring to the coordinator's view.

**Crew knowledge**:
The information available to an individual crew when it independently selects or revises a mission: the common briefing, its own observations, targeted coordinator updates, and limited road-reservation information received automatically.
_Avoid_: Shared global knowledge when referring to a crew's decision inputs.

**Road reservation**:
A timed allocation of capacity on a constrained road segment to an agent, used to coordinate passage and the waiting time required before entry.
_Avoid_: Shared fire forecast; road availability does not reveal other agents' incident knowledge.

**Reversal**:
A ground agent's change of direction from its actual position on a road segment, including turnaround time and the physical journey back along the road.
_Avoid_: Return to the previous junction when referring to an instantaneous position change.

**Coordinator update**:
A natural-language communication, typed or spoken, directed to one crew or scout that supplies relevant incident information and may include a revised objective, which the crew uses to independently reconsider its plan.
_Avoid_: Global knowledge sync when referring to a targeted update.

**Unsupported claim**:
A statement about incident conditions that lacks supporting observations available to the receiving agent, including observations relayed with the statement.
_Avoid_: Observation or verified fact when referring only to a coordinator's assertion.

**Coordinator conversation**:
The single conversation in which the coordinator receives agent reports and addresses one crew or scout at a time; each outgoing message is delivered only to its intended recipient.
_Avoid_: Shared agent memory or broadcast channel when referring to this conversation.

**Active recipient**:
The last crew or scout explicitly addressed by the coordinator, which continues to receive follow-up messages until the coordinator explicitly addresses another agent.
_Avoid_: Latest speaker; incoming agent reports do not change the active recipient.

**Clarification request**:
A question asking the coordinator to resolve an unclear recipient or instruction before the ambiguous message can be acted on.
_Avoid_: Objective rejection; clarification concerns meaning, while rejection concerns feasibility.

**Objective**:
A desired outcome for a crew, such as protecting a particular work site, which the crew evaluates against its knowledge and mission feasibility rules.
_Avoid_: Route or mission when referring only to the desired outcome.

**Mission feasibility**:
Whether a complete mission satisfies the modeled travel, road-use, and return requirements in every retained forecast scenario available to the crew, including a time buffer.
_Avoid_: Guaranteed safety; feasibility is conditional on the crew's knowledge and the simulation's rules.

**Planning buffer**:
An additional time margin required between a crew's planned presence at a location and the forecast arrival of the hazard there.
_Avoid_: Guaranteed extra time; the margin is measured against forecasts.

**Objective rejection**:
A crew's refusal of an objective it evaluates as infeasible after considering the received update, accompanied by an explanation of the constraint preventing execution.
_Avoid_: Ignored instruction when the crew has evaluated the objective and explained its refusal.

**Intervention**:
A deliberate update or direction from the incident coordinator in response to changed conditions or broader incident knowledge.
_Avoid_: Routine approval when referring to intervention; ordinary mission execution does not require approval at every step.

**Autonomous agent**:
A simulated crew or scout that carries out its plan and responds to changing conditions without step-by-step human control.
_Avoid_: Scripted marker when referring to an agent capable of changing its actions in response to new information.

**Scout**:
A ground agent dedicated to investigating information gaps and reporting observed fire conditions to the incident coordinator, without the ability to perform structure-protection work.
_Avoid_: Drone or aerial observer in the initial scenario.

**Protection crew**:
A ground agent capable of performing structure-protection work; losing every protection crew ends the incident even if the scout survives.
_Avoid_: Including the scout when counting protection crews.

**Automatic withdrawal**:
An agent-initiated departure from an ongoing mission when continuing would violate its forecast return requirements and a feasible withdrawal remains available, with a prominent explanation to the coordinator.
_Avoid_: Withdrawal request when the agent has already decided to withdraw.

**Best-effort retreat**:
An emergency attempt to preserve crew lives when no return route satisfies the normal forecast checks, using the lowest estimated exposure among routes the crew believes remain passable.
_Avoid_: Forecast-feasible return or guaranteed escape.

**Stranded report**:
A crew's urgent report that it knows of no passable route to refuge, based on its currently available information.
_Avoid_: Confirmed absence of every possible escape route; the report reflects crew knowledge.

**Crew lost**:
A terminal outcome in which the simulated fire overtakes a crew, permanently removing it from action for that incident.
_Avoid_: Stranded or return-plan failure; neither alone establishes that a crew has been lost.

**Incident end**:
The conclusion of a simulated incident when time expires, the fire is extinguished, all sites are resolved, or all protection crews are lost; site resolution ends the incident without waiting for agents to return to refuge.
_Avoid_: Successful return or full protection when referring only to a run ending.

**Incident time limit**:
The maximum real elapsed play time from the start of the active incident, unless another end condition finishes it sooner.
_Avoid_: Forecast work window or presentation duration when referring to the play limit.

**Fire extinguished**:
The incident outcome in which no active burning cells remain in the simulated world.
_Avoid_: Fire contained, no visible fire, or no further spread when active burning cells still remain.

**Withdrawal report**:
A crew's explanation to the coordinator that it has begun withdrawing and what triggered that decision.
_Avoid_: Withdrawal approval request; the crew is already acting.

**Mission**:
A crew's approach to a work site, planned work interval, and return to a designated refuge, considered together; finishing one mission need not finish the site's task or the incident.
_Avoid_: Route or task when referring to the complete mission.

**Partial-protection mission**:
A complete approach, work, and return mission intended to contribute useful protection without finishing all remaining work at the site.
_Avoid_: Incomplete mission when only the site's protection task is intended to remain unfinished.

**Forecast work window**:
The estimated time available for work while retaining a feasible return under the crew's current forecast and knowledge, subject to revision as conditions and information change.
_Avoid_: Guaranteed work time.

**Task**:
An activity at a work site with a defined duration and value; the first scenario uses structure-protection tasks.
_Avoid_: Mission when referring only to the work.

**Work site**:
A designated fixed location where one or more crews can work on the same structure-protection task in the first scenario.

**Structure protection**:
Work at a designated site that reduces modeled damage to its structures without changing the incident's fire spread in the first scenario.
_Avoid_: Containment or fire suppression when referring to this task's effect.

**Protection progress**:
The combined work completed on a site's structure-protection task, accumulated at the sum of its active crews' work rates and retained when crews leave, up to full task completion.
_Avoid_: Completion flag when referring to progress; protection is not all-or-nothing.

**Protection benefit**:
The reduction in a site's damage accumulation rate, proportional to completed protection progress relative to the maximum benefit of a finished task.
_Avoid_: Survival probability or work rate when referring to the effect of completed protection.

**Site damage**:
The accumulated harm to a site's structures over time exposed to the simulated fire, with protection reducing further damage rather than repairing prior harm.
_Avoid_: Protection progress when referring to damage already suffered.

**Destroyed site**:
A site whose accumulated damage reaches its destruction threshold, permanently preventing further useful protection work in that incident.
_Avoid_: Completed protection; destruction is a failed site outcome.

**Resolved site**:
A site with no remaining protection work because its task is complete or the site is destroyed.
_Avoid_: Saved site; resolution includes failed outcomes.

**Work rate**:
The amount of protection work a crew contributes per unit of simulated time while actively working at a site.
_Avoid_: Damage reduction when referring to how quickly work is completed.

**Refuge**:
A designated destination for crew return, assumed usable within the simulated scenario.
_Avoid_: Guaranteed safe zone.

**Hidden simulated world**:
The actual conditions of the simulated incident, against which crew outcomes are assessed.
_Avoid_: Forecast when referring to what actually happens.

**Forecast ensemble**:
A collection of plausible fire futures retained for a particular decision-maker based on its starting information and observations received so far.
_Avoid_: Hidden future or actual fire when referring to predictions.

**Unreliable forecast**:
A forecast whose retained scenarios cannot explain newly available observations, requiring a rebuild with broader possibilities before it can justify new protection missions.
_Avoid_: Confirmed safety when all scenarios have been ruled out.

**Observation**:
A crew's or scout's sighting of incident conditions within its observation radius at a particular time, including fire state and local site progress or damage.
_Avoid_: Forecast when referring to observed conditions, or live observation when referring to an older sighting.

**Report**:
An agent's communication to the coordinator describing observations, actions, or decisions; an observation can update the incident picture without a separate spoken report.
_Avoid_: Observation when referring to a report about an action or decision.

**Observation radius**:
The fixed distance around a crew or ground scout within which it can observe current fire and site conditions, without terrain blocking visibility.
_Avoid_: Complete incident view or terrain-aware line of sight.

**Latest modeled departure time**:
The estimated latest time a crew can leave a work site while retaining a feasible return under the selected forecast rule, revised as the crew's information and forecast change.
_Avoid_: Guaranteed safe departure time.

**Initial briefing**:
The common starting map, agent capabilities, site information, refuges, and limited initial incident observation available before play begins.
_Avoid_: Hidden world state when referring to starting knowledge.

**Incident time**:
The modeled time used for fire spread, movement, work, and forecasts, advancing at a fixed rate relative to real play time.
_Avoid_: Unlabeled minutes when comparing modeled durations with the real play countdown.

**Urgent call**:
An immediate report of withdrawal, emergency retreat, stranding, or loss that takes priority over routine speech without delaying the agent's action.
_Avoid_: Permission request when reporting survival action already underway.

**Interrupted mission**:
A mission whose return outcome is not completed because the incident ends, recorded separately from a successful return or crew loss.
