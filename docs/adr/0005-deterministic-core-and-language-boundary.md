# Keep simulation and mission authority in deterministic code

Use a small TypeScript agent runtime with explicit per-agent state and complete-mission planning. Grok interprets coordinator language and synthesizes grounded speech; it does not decide whether a road is physically open, invent observations, advance time, or bypass feasibility checks. Model latency must not delay automatic withdrawal.

An LLM-driven tool loop for every crew would add variable timing and complicate replay without replacing the required fire, route, and reservation algorithms. Independent behavior remains visible through autonomous choices, refusals, and survival actions.

Defer openJiuwen from the MVP critical path after a documentation-based fit assessment. Its orchestration may be useful around a later bounded communication workflow, but adopting its Python runtime now would add another integration boundary to the chosen TypeScript core. This is a fit decision, not a measured claim of incompatibility or poor performance. See [the evaluation and reconsideration gate](../OPENJIUWEN_EVALUATION.md).
