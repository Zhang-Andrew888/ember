# Ember Line

A five-minute wildfire coordination simulation with autonomous ground crews, incomplete information, conversational control, and a Three.js incident view.

**Status:** design package completed on 2026-10-03. This workspace contains specifications, not an implemented or benchmarked application. The user delegated the remaining design choices after the interview. Defaults below are concrete implementation starting points, not measured wildfire parameters or performance claims.

## Read in this order

| Document | Purpose |
|---|---|
| [Product specification](EMBER_LINE.md) | Accepted experience, rules, scope, and definition of done |
| [Domain language](CONTEXT.md) | Canonical glossary |
| [Architecture](docs/ARCHITECTURE.md) | Runtime boundaries, ownership, contracts, and replay |
| [Simulation and scenario](docs/SIMULATION.md) | Clock, fire, damage, observations, loss, and initial parameters |
| [Navigation and agents](docs/NAVIGATION_AGENTS.md) | Forecasts, route planning, autonomy, reservations, and scouting |
| [Communication](docs/COMMUNICATION.md) | Text, Grok push-to-talk, evidence, clarification, and urgent audio |
| [Three.js frontend](docs/FRONTEND.md) | Visual direction, layout, interaction, rendering, and accessibility |
| [openJiuwen evaluation](docs/OPENJIUWEN_EVALUATION.md) | Evidence, fit assessment, decision, and reconsideration path |
| [Implementation plan](docs/IMPLEMENTATION_PLAN.md) | Ordered vertical slices with acceptance gates |
| [Validation and demo](docs/VALIDATION.md) | Behavioral checks, honest comparisons, performance targets, and showcase |

Architectural decisions are in [docs/adr](docs/adr/README.md). The product specification consolidates the interview decisions; technical details live in the focused documents above.

## Chosen stack

React + TypeScript + Vite; Three.js through React Three Fiber; a Node.js/TypeScript server; an authoritative simulation worker and separate forecast workers; Grok Voice APIs for push-to-talk and speech. Use a small custom agent runtime with deterministic planning. Defer openJiuwen from the MVP critical path.

No additional product interview is required. Implementation should tune the documented defaults against the acceptance gates, record material changes, and preserve the user's explicit requirements. Dependency versions, provider access, source map assets, and performance still require validation during implementation.
