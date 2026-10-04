/**
 * "How to order a fire line": a short note beside the message box. The two examples are rows from
 * the order language (FIREBREAK_PLAN.md 2.4): the first is the shortest form, the second names two
 * crews and which end each takes. Everything is plain text, so nothing here depends on colour.
 */
export const FIRE_LINE_HELP_EXAMPLES: readonly string[] = [
  "Crew 1, cut line from Waterworks to Ridge Cabins.",
  "Crew 1 and Crew 2, cut line from 200 m west of East Junction, 500 m north. Crew 1 on the south end, Crew 2 on the north end.",
];

export function FireLineHelp() {
  return (
    <details className="fire-line-help">
      <summary>How to order a fire line</summary>
      <p>Name where the line starts and where it goes. Say which crew takes which end if two crews work it.</p>
      <ul aria-label="Example fire line orders">
        {FIRE_LINE_HELP_EXAMPLES.map((example) => (
          <li key={example}>
            <q>{example}</q>
          </li>
        ))}
      </ul>
      <p className="fire-line-help__compass">
        <strong>Directions follow the on-screen compass.</strong> North, south, east and west are compass points, not
        screen sides: at the start, north is at the bottom of the screen. Do not say top or bottom; the crews do not
        know your camera angle.
      </p>
    </details>
  );
}
