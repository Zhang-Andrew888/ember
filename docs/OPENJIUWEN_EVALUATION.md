# openJiuwen evaluation

Decision date: 2026-10-03. Scope: the openJiuwen agent-core SDK as a possible runtime for Ember Line's crew agents.

**Decision: do not put openJiuwen on the MVP critical path.** Use the TypeScript controllers and planner described in [architecture](ARCHITECTURE.md). Retain a narrow optional integration boundary for a later experiment.

This is a documentation-based architectural assessment. The SDK was not installed, and no framework or provider integration benchmark was run.

## What the official sources establish

openJiuwen Core is a Python SDK for LLM applications, with ReAct/workflow agents, tool invocation, asynchronous/streaming execution, state recovery, and observability. Its repository identifies the project as Apache-2.0 licensed. These are relevant capabilities for a conversational orchestration layer. [Official repository](https://github.com/openJiuwen-ai/agent-core).

Its multi-agent documentation describes TeamRuntime for registration and message routing, and CommunicableAgent for point-to-point and publish-subscribe communication. Targeted messages therefore are a plausible fit; isolated crew knowledge would still be Ember Line's responsibility. [Official multi-agent guide](https://github.com/openJiuwen-ai/agent-core/blob/develop/docs/en/2.Development%20Guide/Multi-Agent/TeamRuntime-and-CommunicableAgent.md).

The development branch metadata inspected declares Python >=3.11,<3.14 and version 0.1.18. That is a snapshot of development metadata, not a claim about the latest published package or a recommended production pin. [Project metadata](https://raw.githubusercontent.com/openJiuwen-ai/agent-core/develop/pyproject.toml).

## Fit against this MVP

The judgments in this table are our architectural inferences from Ember Line's requirements, not claims of measured SDK limitations.

| Requirement | Assessment |
|---|---|
| Four agents with separate knowledge | Achievable with scoped state and addressed messages; still requires our information-boundary tests |
| Deterministic fire, movement, and damage | Our simulation must implement these regardless of orchestration framework |
| All-scenario timed mission checks | Our graph search, ensemble checks, and reservation logic remain custom |
| Agent initiative without human approval | Already implemented by event-driven controllers; does not require an LLM deliberation loop |
| Natural-language objectives and clarification | Framework orchestration could help, but one validated interpreter path is sufficient initially |
| Grok push-to-talk and urgent playback | Custom audio/session handling is still needed; no documented native Grok Realtime adapter was established by this review |
| Reproducible runs | Need our ordered simulation events and recorded model outputs regardless of framework |
| Browser/server shared schemas | An all-TypeScript core keeps one contract language; a Python SDK adds a language/process boundary |
| Debugging a small hackathon system | Existing app event logs cover the immediate need; framework tracing has more value as orchestration grows |

The strongest fit is outside the fixed simulation loop: interpreting a coordinator request, managing a more elaborate dialogue, or composing a bounded planning workflow. The weakest reason to adopt it is simply that crews are called “agents.” Their autonomy is defined by their actions and knowledge, not by an SDK class.

The decision is not that openJiuwen cannot meet these requirements. It is that its incremental value does not currently justify another runtime, adapter layer, and failure boundary alongside a Three.js frontend and Grok voice integration. We have not measured its latency and do not claim it is too slow.

## Options considered

1. **Custom TypeScript controllers — selected.** One language for simulation contracts and application state; explicit scheduling and knowledge boundaries. We build the small controller/state-machine layer ourselves.
2. **Python simulation plus openJiuwen controllers.** Coherent if the project already had a Python modeling core, but no such code exists here. It also keeps the browser boundary separate without eliminating the custom model work.
3. **TypeScript simulation plus Python openJiuwen sidecar.** Preserves the chosen core but adds RPC, lifecycle coordination, and stale-result handling. Defer until a concrete orchestration need justifies it.

Do not add a package dependency solely for branding or claim that it powers crews if it is only an unused adapter.

## Bounded reconsideration experiment

If a future integration is valuable, put a WorkflowAgent around one crew's communication handler. Use a dedicated session key per incident and recipient and point-to-point delivery only. Disable implicit sharing of the coordinator transcript. Retain the TypeScript planner as the authority.

Allowed boundary:

```text
input:  agentId, knowledgeRevision, scopedAgentSnapshot, targetedMessage
output: interpretedIntent or clarification, plus evidence references
```

The wrapper cannot mutate positions, append observations, mark a road safe, commit reservations, or bypass mission admission. Every output is revalidated by the same command gateway. A stale response is discarded or reevaluated against current state.

Promote the experiment only if it:

- Passes the same information-leakage and infeasible-objective tests as the custom path.
- Preserves urgent withdrawal when model requests are slow or unavailable.
- Supports the required Grok integration with an explicitly tested adapter.
- Produces a measurable reduction in implementation/maintenance complexity.
- Meets the application's measured response budget without extending the simulation tick.
- Can be disabled without changing a scenario's deterministic world rules.

Until then, the implementation plan has no openJiuwen dependency or second runtime.
