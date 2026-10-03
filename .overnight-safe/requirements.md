# Optional future planning only
Read AGENTS.md and docs/IMPLEMENTATION_PLAN.md. Inspect the earliest incomplete
slice using only its relevant source/specifications. Produce at most two
independent tasks: one in a single sim package/apps/server for Claude, one in
apps/web for Cursor. Shared domain, fixtures, root configuration, dependencies,
docs, and workflows remain read-only. Include at most eight required read_paths.
Use the configured per-task $12 Claude limit and 45-minute time limit; Cursor
budget is zero. Require exactly pnpm typecheck, pnpm lint, pnpm test. Do not
invent a replacement architecture or duplicate simulation in the web lane.
Default tasks are already provided; do not call the planner for this first run.
