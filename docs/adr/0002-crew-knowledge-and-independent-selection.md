# Crews select missions from their own knowledge

Each crew independently selects executable missions using its common briefing, own observations, targeted coordinator updates, and limited road-reservation information. This replaces centralized assignment from a shared world view: differences in information make agent initiative and human coordination consequential.

Local observations automatically reach the coordinator, independently of narration. They do not automatically reach every agent. Relayed evidence retains source and time; unsupported coordinator assertions cannot establish safe conditions. The combined human conversation is not shared agent memory.

Feasible coordinator objectives supersede autonomous choices, including ongoing missions. Infeasible objectives are rejected with a concrete reason. A new rejected objective does not erase an existing feasible plan; survival actions retain precedence. After partial work and return, crews select more feasible missions while unresolved work remains.

Traffic uses an automatic reservation service exposing only availability and allocated times. It negotiates yielding with each controller's own feasibility checks. Occupied segments cannot be preempted, and a reversing agent retains occupancy until physical exit. Priority and tie-breaking are fixed in [navigation](../NAVIGATION_AGENTS.md).

A shared process or immutable forecast cache is allowed when input isolation is enforced. The agent's behavioral independence does not require a separate service or unrestricted inter-agent messaging.
