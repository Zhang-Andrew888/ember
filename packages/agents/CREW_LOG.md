# Crew log (feat/crew)

Running log for the crew increments. Newest last. (Each branch adds its own section; expect trivial add/add merges on this file.)

## Increment 5: scout value of information (feat/crew-5-scout-voi, from main)
- `voi.ts`: pure `scoreObservationPoint`. Decision score stays the documented ranking input (disagreement 4p(1-p) times public site-access importance, divided by time by the planner), so behaviour is unchanged. Information bits (binary entropy) are reported alongside as the measurable quantity.
- Already-seen-closed corridors score 0 (nothing left to learn); unanimous members score 0; importance 0 scores 0.
- `ScoutController.voiRanking` exposes every considered point's score breakdown, best first, so the choice is inspectable and testable.
- Removed `ScoutController.disagreement` (now in voi.ts); no other caller.
- Not done: relayed crew missions/deadlines in scout ranking (a documented gap in NAVIGATION_AGENTS.md; needs the coordinator relay path).
