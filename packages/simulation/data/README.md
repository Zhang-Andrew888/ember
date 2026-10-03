# Montclair scenario data

Road geometry in `scenario-osm-montclair-v1.json` is derived from OpenStreetMap.

**© OpenStreetMap contributors**, licensed under the Open Database License (ODbL) 1.0.
See <https://www.openstreetmap.org/copyright>.

| File | What it is |
|---|---|
| `osm-montclair-roads.json` | Raw Overpass API response (drivable `highway` ways and their nodes) for the box 37.8205,-122.2240 to 37.8405,-122.1990. Data timestamp in the file's `osm3s.timestamp_osm_base`. |
| `osm-montclair-roads.query.txt` | The exact Overpass query used. |
| `scenario-osm-montclair-v1.json` | The frozen scenario: a 1.6 km crop of the extract plus the authored layer. |
| `scenario-osm-montclair-v1.provenance.json` | Source, licence, crop origin, scenario hash, the OSM way ids behind each edge, and what was omitted. |

Node ids are `n-<OSM node id>`; edge ids are `e-<from OSM node>-<to OSM node>`.

**Real:** road geometry (driveway-class `service` ways and segments with an end outside the crop are left out).
**Authored:** terrain height and fuel, site/refuge/scouting-point choice, the single-capacity segment, the ignition patch.

Regenerate with `node packages/simulation/scripts/osm-to-scenario.mjs` after building the package; the output is
deterministic for a given extract. `src/osm-montclair-scenario.generated.ts` is written by the same script.
