# Art direction (feat/web-scene)

Source: Andrew, mid-session message. Saved verbatim so it survives context compaction.

Legibility of product-critical states always beats decoration. If frame time misses
the target, cut decoration first.

Look: a dusk-lit wildfire map that feels like a polished game scene, not a debug view.
Warm fire light against cool shadowed terrain.

1. Trees: instanced low-poly conifers (InstancedMesh, one draw call per species),
   varied scale, rotation and tint, a subtle wind sway in the vertex shader, and
   density driven by the vegetation data. Burning trees char and darken. Burnt ground
   stays visible.
2. Fire: built from noise-driven shader billboards or instanced flame cards with
   additive blending, plus rising ember particles and a faint smoke layer. Intensity
   follows the fire cell's state. Flicker must be calm and honour reduced-motion.
   Prefer a hand-written shader. If you want a library (for example @wolffo/three-fire
   or @react-three/postprocessing), add it only with a comment justifying it.
3. Light and atmosphere: filmic tone mapping, one warm key light plus cool fill, soft
   shadows only where they help, distance fog and haze, and fire light that tints
   nearby terrain and trees. Light up the ground near observed fire cells.
4. Post-processing, kept light: gentle bloom on fire only, a subtle vignette, and
   anti-aliasing. Each effect needs a quality-tier switch and must be off in
   reduced-motion or low-end mode.
5. Camera and framing: smooth easing, slight depth of field is optional, never at the
   cost of readable labels.
6. Quality tiers: low, medium and high. Pick automatically from measured frame time and
   allow a manual override in a dev-only debug panel (tweak colours, light
   positions, fog, bloom). Never ship that panel in the production build.

HARD RULES: only observed fire is drawn in active mode. Unknown areas stay dark or
hatched. Stale observations fade. Full fire shows ONLY in replay mode, and a test
proves it. Status must never depend on colour alone. Keep route, forecast, crews and
sites readable on top of all effects.

PROCESS: after each visual change, take a Playwright screenshot at the target viewport
and 1024x720, compare with the previous one, and write a short self-critique in
OVERNIGHT_LOG.md (what looks off, what you changed). Fix anything that looks muddy,
noisy, flat or unreadable before committing.
