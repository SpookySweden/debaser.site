import { parseValues, type BackdropDef, type Values } from '../knobs';

/**
 * MYSTIFY's knobs (SPEC-backgrounds.md). As it comes it is the Windows 98 screensaver: two four-cornered shapes bouncing round
 * the screen, each trailing a few echoes and slowly changing colour.
 */

const DEFAULTS: Values = {
  shapes: 2,
  corners: 4,
  trails: 6,
  gap: 3,
  speed: 30,
  gravity: 0,
  springs: 0,
  pointer: 'ignore',
  solid: false,
  line: 1,
  cell: 3,
  colours: 'dyes',
  cycle: 30,
  time: 1,
};

const BASE: BackdropDef = {
  id: 'mystify',
  label: 'MYSTIFY',
  tabs: [
    { id: 'shapes', label: 'SHAPES' },
    { id: 'physics', label: 'PHYSICS' },
    { id: 'look', label: 'LOOK' },
  ],
  knobs: [
    { kind: 'range', key: 'shapes', tab: 'shapes', label: 'SHAPES', tip: 'HOW MANY SHAPES', min: 1, max: 6, step: 1, unit: '', party: [1, 5] },
    { kind: 'range', key: 'corners', tab: 'shapes', label: 'CORNERS', tip: 'HOW MANY CORNERS EACH SHAPE HAS', min: 2, max: 8, step: 1, unit: '', party: [3, 7] },
    { kind: 'range', key: 'trails', tab: 'shapes', label: 'TRAILS', tip: 'HOW MANY ECHOES FOLLOW EACH SHAPE', min: 0, max: 40, step: 1, unit: '', party: [2, 24] },
    { kind: 'range', key: 'gap', tab: 'shapes', label: 'TRAIL GAP', tip: 'HOW FAR APART THE ECHOES ARE', min: 1, max: 8, step: 1, unit: '', party: [1, 5] },
    { kind: 'range', key: 'speed', tab: 'shapes', label: 'SPEED', tip: 'HOW FAST THE CORNERS FLY', min: 0, max: 100, step: 5, unit: '%', party: [10, 80] },
    { kind: 'range', key: 'gravity', tab: 'physics', label: 'GRAVITY', tip: 'THE CORNERS HAVE WEIGHT: THEY FALL AND BOUNCE', min: -100, max: 100, step: 5, unit: '', signed: true, party: [-40, 60] },
    { kind: 'range', key: 'springs', tab: 'physics', label: 'SPRINGS', tip: 'THE CORNERS OF A SHAPE PULL ON ONE ANOTHER, SO IT WOBBLES AND HOLDS TOGETHER', min: 0, max: 100, step: 5, unit: '%', party: [0, 80] },
    {
      kind: 'choice',
      key: 'pointer',
      tab: 'physics',
      label: 'POINTER',
      tip: 'WHAT YOUR POINTER DOES TO THE CORNERS',
      party: true,
      options: [
        { value: 'ignore', label: 'IGNORE', tip: 'THEY TAKE NO NOTICE' },
        { value: 'pull', label: 'PULL', tip: 'IT DRAWS THEM IN' },
        { value: 'push', label: 'PUSH', tip: 'IT DRIVES THEM OFF' },
      ],
    },
    { kind: 'switch', key: 'solid', tab: 'physics', label: 'WINDOWS ARE SOLID', tip: 'THE CORNERS BOUNCE OFF THE SITE WINDOW AS WELL AS THE SCREEN', party: 0.4 },
    { kind: 'range', key: 'time', tab: 'physics', label: 'TIME', tip: 'EVERYTHING SLOWER OR FASTER', min: 0.25, max: 3, step: 0.25, unit: 'x', party: [0.5, 2] },
    { kind: 'range', key: 'line', tab: 'look', label: 'LINE', tip: 'HOW THICK THE LINES ARE', min: 1, max: 4, step: 1, unit: '', party: [1, 3] },
    { kind: 'range', key: 'cell', tab: 'look', label: 'GRID', tip: 'HOW BIG ONE DOT OF A LINE IS ON THE SCREEN. CHANGING IT STARTS THE SHAPES AGAIN', min: 2, max: 8, step: 1, unit: 'px', party: [2, 5] },
    {
      kind: 'choice',
      key: 'colours',
      tab: 'look',
      label: 'COLOURS',
      tip: 'WHICH COLOURS THE SHAPES GO THROUGH',
      party: true,
      options: [
        { value: 'dyes', label: 'DYES', tip: "THE SITE'S BRIGHT ONES" },
        { value: 'cool', label: 'COOL', tip: 'BLUES, MINT AND WHITE' },
        { value: 'mono', label: 'MONO', tip: 'WHITE AND GREY' },
        { value: 'rainbow', label: 'RAINBOW', tip: 'ROUND THE WHOLE WHEEL' },
      ],
    },
    { kind: 'range', key: 'cycle', tab: 'look', label: 'COLOUR CYCLE', tip: 'HOW FAST A SHAPE CHANGES COLOUR', min: 0, max: 100, step: 5, unit: '%' },
  ],
  widgets: [],
  actions: [],
  defaults: DEFAULTS,
  looks: [],
  partyRests: [
    { key: 'gravity', chance: 0.5 },
    { key: 'springs', chance: 0.5 },
  ],
};

const look = (changes: Values): Values => parseValues(BASE, { ...DEFAULTS, ...changes });

export const MYSTIFY_DEF: BackdropDef = {
  ...BASE,
  looks: [
    { id: '98', label: '98', tip: 'THE WINDOWS 98 SCREENSAVER, AS IT CAME', values: DEFAULTS },
    { id: 'jelly', label: 'JELLY', tip: 'SIX-CORNERED BLOBS ON SPRINGS, WITH WEIGHT', values: look({ shapes: 3, corners: 6, springs: 70, gravity: 35, trails: 10, gap: 2, line: 2, pointer: 'push', colours: 'rainbow' }) },
    { id: 'cage', label: 'CAGE', tip: 'FAST LINES RATTLING ROUND THE SITE WINDOW', values: look({ shapes: 5, corners: 2, speed: 75, trails: 20, gap: 1, solid: true, colours: 'cool', cycle: 60 }) },
  ],
};
