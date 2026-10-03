# Three.js frontend

## Visual direction

Build an incident command desk around a tilted 3D terrain model. It should feel tactile, calm, and readable while the simulation becomes tense. The primary action is communicating; the scene explains the consequences.

Use React + TypeScript + Vite with Three.js through React Three Fiber and a small selection of Drei camera/label helpers. React Three Fiber is a React renderer for Three.js; its current documentation pairs Fiber 9 with React 19. Use that stable major pairing, pin exact compatible versions when implementing, and avoid the alpha rendering path for the MVP. [Official introduction](https://r3f.docs.pmnd.rs/getting-started/introduction).

## Layout

Desktop target: 1440 × 900; usable down to 1024 × 720.

| Region | Content |
|---|---|
| Top bar, 56 px | EMBER LINE, incident clock, connection/audio status |
| Main scene, approximately 68% width | Terrain, roads, crews, sites, known fire, forecast |
| Right panel, at least 340 px | One conversation, report timestamps, text input, push-to-talk |
| Persistent urgent strip above composer | Crew name, actual action, reason, audio pending/playing |
| Lower scene rail | Four compact agent cards; selecting one inspects/follows it |
| Upper scene corner | Layer legend, forecast reliability, reset camera |
| End overlay | Ending reason, actual outcomes, replay/start-again actions |

Keep the active conversation recipient separate from the inspected agent. Clicking a crew card may focus the camera but must not silently address that crew.

On narrower screens stack scene above conversation and preserve the urgent strip and composer. Desktop is the release target; no separate mobile-control design is required.

## Art and color

- Background: charcoal `#11191C`; panels: `#1B272B`; primary text: `#F1F4ED`.
- Terrain: muted sage and ochre, low-poly elevation; subdued road base.
- Crew identifiers use a color plus number and silhouette. Scout has a distinct binocular icon.
- Current observed fire: solid ember orange `#FF6B35`, with compact animated flame clusters.
- Forecast envelope: translucent amber hatching and time labels, never identical to observed flames.
- Stale observations: desaturated outline with age; unknown fire areas remain visually quiet with an “unobserved” legend.
- Refuge: cyan `#70D6D1`; rejected/infeasible plan: labeled muted red, not a flashing full scene.
- Site protection and site damage have separate indicators. “60% protected” is not “60% health.”

Use system sans-serif for readable text and tabular numerals for clocks. Thin route lines become thicker on selection. Limit bloom to the visible fire layer; avoid smoke that hides routes or labels. No volumetric-fire or physics-engine dependency.

## Scene composition

Use an orthographic camera with a fixed initial tilt around 50 degrees, bounded pan and zoom, and a reset button. Allow modest orbit for inspection but constrain tilt so labels remain legible. Animate transitions over 250 ms and honor reduced-motion preferences.

Layers, from ground upward:

1. Terrain mesh and quiet contour bands.
2. Locally packaged road polylines, constrained segment markings, refuge markers.
3. Observed burned/active cells, with timestamps in inspection.
4. Coordinator forecast contour/envelope and reliability legend.
5. Site models and status labels.
6. Instanced crew markers, selected approach/return route, reservation-wait indicator.
7. DOM labels and tooltips.

Render only the coordinator projection received from the server. Unknown actual fire, hidden future weather, and other agents' private forecasts are not browser payloads. The selected agent's reportable plan can be inspected; this does not reveal unreported hidden facts.

Three.js supports instanced meshes for repeated geometry. Use instancing for fire cells, trees, and repeated markers; avoid one React component per changing cell. [InstancedMesh documentation](https://threejs.org/docs/pages/InstancedMesh.html).

## Interaction and accessibility

Map interactions: inspect, pan, zoom, follow agent, toggle observation/forecast layers. They never create tasks, select a communication recipient, or attach evidence to a message.

Use real DOM buttons, input, transcript, status cards, and accessible names. Push-to-talk supports pointer hold and Space when focus is outside the text composer; release/cancel/lost-focus always ends capture safely. Do not intercept Space while typing. Provide a visible microphone permission/error state and equivalent text input.

Urgent changes go to an accessible alert region once per event. Routine updates use a polite live region and are coalesced. Do not convey observed/forecast, safe/unsafe, or crew identity by color alone.

## Screens and transitions

- **Briefing:** title, fictional-incident label, three sites and values, four callsigns, observation legend, microphone check, “Start incident.” Clock is stopped until Start.
- **Live:** no pause, command buttons, or speed slider. Show remaining real time; forecasts and ETAs use clearly labeled incident time.
- **Clarification:** question appears in the same conversation; ongoing action and clock remain visible.
- **Urgent while recording:** urgent strip and transcript update immediately; a small “audio next” label appears. Recording is preserved.
- **Ending:** freeze scene at actual end state, cancel unapplied commands, finish or cancel audio according to communication rules, show debrief.
- **Replay:** seekable timeline with an explicit “replay: full simulated fire” toggle; commands disabled.

## Rendering and QA targets

Aim for 60 FPS on the development laptop and at least 30 FPS at 1440 × 900 on the documented test machine. These are targets, not measured results. Cap pixel ratio at 1.5; lower decorative detail before reducing legibility. Interpolate between authoritative snapshots; never extrapolate agents through unseen hazards.

Use snapshot subscriptions and mutable mesh buffers for animation; keep simulation state out of per-frame React reconciliation. Reuse materials and geometries and dispose resources on scene teardown. Validate label overlap, audio indicators, color contrast, keyboard use, and context recovery in [validation](VALIDATION.md).
