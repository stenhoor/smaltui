// Workbench icons in the smalt-brand Chevron style (BRAND.md, Iconography), drawn like smaltbi's (src/visuals/icons.ts):
// solid shapes on a 24 px grid, no strokes, edges at 0°, 45° and 90° only, bars at least 2.5 units thick, and at most one
// chip (a rounded bar, class "k") for the detail that matters. The body takes currentColor; the chip takes the user-tool
// layer colour (styles.css, `.i .k`).

const svg = (body: string): string => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;
const r = (x: number, y: number, w: number, h: number): string => `<rect x="${x}" y="${y}" width="${w}" height="${h}"/>`;
const chip = (x: number, y: number, w: number, h: number): string => `<rect class="k" x="${x}" y="${y}" width="${w}" height="${h}" rx="1.1"/>`;
const poly = (pts: string, k = false): string => `<path${k ? ' class="k"' : ''} d="M${pts}Z"/>`;
/** A frame: the outer rectangle less the inner one. */
const frame = (x: number, y: number, w: number, h: number, t: number): string =>
  `<path fill-rule="evenodd" d="M${x},${y}H${x + w}V${y + h}H${x}ZM${x + t},${y + t}V${y + h - t}H${x + w - t}V${y + t}Z"/>`;
/** An octagon (the Chevron style's circle): left/top edge `a`, right/bottom edge `b`, corner cut `c`. */
const oct = (a: number, b: number, c: number): string => `${a + c},${a} ${b - c},${a} ${b},${a + c} ${b},${b - c} ${b - c},${b} ${a + c},${b} ${a},${b - c} ${a},${a + c}`;

export const ICONS = {
  // Objects in the explorer.
  table: svg(chip(3, 3, 18, 5) + r(3, 10.5, 8, 4) + r(13, 10.5, 8, 4) + r(3, 17, 8, 4) + r(13, 17, 8, 4)),
  view: svg(frame(3, 3, 18, 18, 3) + chip(8.5, 10, 7, 4)),
  matview: svg(r(3, 3, 18, 4) + r(3, 10, 18, 4) + chip(3, 17, 18, 4)),
  external: svg(`<path d="M3,5H12V8H6V18H16V12H19V21H3Z"/>` + poly('10,12 16,6 13,6 13,3 21,3 21,11 18,11 18,8 12,14', true)),
  temp: svg(r(3, 3, 8, 5) + r(13, 3, 8, 5) + r(3, 10.5, 8, 4) + chip(13, 10.5, 8, 4) + r(3, 17, 8, 4)),
  connection: svg(r(7, 2, 3, 6) + r(14, 2, 3, 6) + poly('4,8 20,8 20,13 15,18 9,18 4,13') + chip(10.5, 18, 3, 4)),
  // Tabs and actions.
  query: svg(frame(2, 4, 20, 16, 2.5) + poly('6,8.5 8,8.5 11.5,12 8,15.5 6,15.5 9.5,12') + chip(12.5, 13.5, 5.5, 2.5)),
  // A frame: a header row, an index column, and one value as the chip (TypeScript tabs, smaltdf).
  typescript: svg(r(9, 3, 12, 4) + r(3, 9, 4, 12) + chip(9, 9, 5, 5) + r(16, 9, 5, 5) + r(9, 16, 5, 5) + r(16, 16, 5, 5)),
  import: svg(r(10.5, 2, 3, 8) + poly('6,9 18,9 12,15', true) + `<path d="M3,13H6V18H18V13H21V21H3Z"/>`),
  history: svg(`<path fill-rule="evenodd" d="M${oct(3, 21, 5.3)}ZM${oct(6, 18, 4.1)}Z"/>` + r(10.75, 7, 2.5, 6) + chip(10.75, 10.75, 5.5, 2.5)),
  welcome: svg(poly('12,2.5 21.5,12 21.5,21 15,21 15,15 9,15 9,21 2.5,21 2.5,12') + chip(10.5, 16.5, 3, 4.5)),
  more: svg(r(3, 10, 4, 4) + r(10, 10, 4, 4) + chip(17, 10, 4, 4)),
  plus: svg(r(10.5, 4, 3, 16) + r(4, 10.5, 16, 3)),
  close: svg(poly('5,7 7,5 19,17 17,19') + poly('17,5 19,7 7,19 5,17')),
  database: svg(r(4, 3, 16, 5) + r(4, 10, 16, 4) + chip(4, 16, 16, 5)),
  link: svg(frame(2, 8, 10, 8, 2.5) + frame(12, 8, 10, 8, 2.5) + chip(8, 10.75, 8, 2.5)),
} satisfies Record<string, string>;

export type IconName = keyof typeof ICONS;

/** An icon as HTML. */
export const icon = (name: IconName): string => ICONS[name];
