import { parseValues, type BackdropDef, type Values } from '../knobs';

/**
 * STARFIELD's knobs (SPEC-backgrounds.md). As it comes it is the Windows 98 screensaver: white stars rushing out of the
 * middle of the screen.
 */

const DEFAULTS: Values = {
  stars: 200,
  speed: 30,
  warp: 10,
  reverse: false,
  spin: 0,
  originX: 0,
  originY: 0,
  steer: false,
  spread: 60,
  wind: 0,
  fall: 0,
  size: 2,
  cell: 3,
  colours: 'white',
  twinkle: 20,
  time: 1,
  touch: 'nudge',
};

const BASE: BackdropDef = {
  id: 'starfield',
  label: 'STARFIELD',
  tabs: [
    { id: 'flight', label: 'FLIGHT' },
    { id: 'sky', label: 'SKY' },
    { id: 'look', label: 'LOOK' },
    { id: 'press', label: 'PRESS A STAR' },
  ],
  knobs: [
    { kind: 'range', key: 'stars', tab: 'flight', label: 'STARS', tip: 'HOW MANY STARS', min: 20, max: 800, step: 10, unit: '', party: [80, 600] },
    { kind: 'range', key: 'speed', tab: 'flight', label: 'SPEED', tip: 'HOW FAST YOU FLY THROUGH THEM', min: 0, max: 100, step: 1, unit: '%', party: [10, 90] },
    { kind: 'range', key: 'warp', tab: 'flight', label: 'WARP', tip: 'HOW LONG A STREAK EACH STAR LEAVES', min: 0, max: 100, step: 5, unit: '%', party: [0, 80] },
    { kind: 'switch', key: 'reverse', tab: 'flight', label: 'REVERSE', tip: 'FLY BACKWARDS: THE STARS FALL AWAY INTO THE MIDDLE', party: 0.2 },
    { kind: 'range', key: 'spin', tab: 'flight', label: 'SPIN', tip: 'THE WHOLE SKY TURNS, ONE WAY OR THE OTHER', min: -100, max: 100, step: 5, unit: '', signed: true, party: [-60, 60] },
    { kind: 'range', key: 'originX', tab: 'flight', label: 'FROM ACROSS', tip: 'WHERE THE STARS COME FROM, LEFT TO RIGHT', min: -100, max: 100, step: 5, unit: '', signed: true, party: [-50, 50] },
    { kind: 'range', key: 'originY', tab: 'flight', label: 'FROM DOWN', tip: 'WHERE THE STARS COME FROM, TOP TO BOTTOM', min: -100, max: 100, step: 5, unit: '', signed: true, party: [-50, 50] },
    { kind: 'switch', key: 'steer', tab: 'flight', label: 'STEER', tip: 'THE STARS COME FROM WHEREVER YOUR POINTER IS', party: 0.3 },
    { kind: 'range', key: 'spread', tab: 'sky', label: 'SPREAD', tip: 'HOW WIDE THE STARS FAN OUT', min: 20, max: 100, step: 5, unit: '%' },
    { kind: 'range', key: 'wind', tab: 'sky', label: 'WIND', tip: 'THE STARS DRIFT LEFT (-) OR RIGHT (+)', min: -100, max: 100, step: 5, unit: '', signed: true, party: [-40, 40] },
    { kind: 'range', key: 'fall', tab: 'sky', label: 'FALL', tip: 'THE STARS FALL DOWN THE SCREEN, LIKE SNOW', min: 0, max: 100, step: 5, unit: '%', party: [0, 50] },
    { kind: 'range', key: 'twinkle', tab: 'sky', label: 'TWINKLE', tip: 'HOW MUCH EACH STAR FLICKERS', min: 0, max: 100, step: 5, unit: '%' },
    { kind: 'range', key: 'time', tab: 'sky', label: 'TIME', tip: 'EVERYTHING SLOWER OR FASTER', min: 0.25, max: 3, step: 0.25, unit: 'x', party: [0.5, 2] },
    { kind: 'range', key: 'size', tab: 'look', label: 'STAR SIZE', tip: 'HOW BIG THE NEAREST STARS GET', min: 1, max: 5, step: 1, unit: '', party: [1, 4] },
    { kind: 'range', key: 'cell', tab: 'look', label: 'GRID', tip: 'HOW BIG ONE DOT IS ON THE SCREEN. CHANGING IT STARTS THE SKY AGAIN', min: 2, max: 8, step: 1, unit: 'px', party: [2, 5] },
    {
      kind: 'choice',
      key: 'colours',
      tab: 'look',
      label: 'COLOURS',
      tip: 'WHAT COLOUR THE STARS ARE',
      party: true,
      options: [
        { value: 'white', label: 'WHITE', tip: 'AS THE SCREENSAVER HAD THEM' },
        { value: 'dyes', label: 'DYES', tip: "THE SITE'S OWN" },
        { value: 'warm', label: 'WARM', tip: 'YELLOWS AND ORANGES' },
        { value: 'rainbow', label: 'RAINBOW', tip: 'EVERY COLOUR' },
      ],
    },
    {
      // What a press on one star does (`./touch.ts`). Not a look: the looks, MORPH and PARTY leave it as the reader has it.
      kind: 'choice',
      key: 'touch',
      tab: 'press',
      label: 'A PRESS',
      tip: 'WHAT PRESSING ONE STAR DOES. PRESS THE EMPTY SKY TWICE, QUICKLY, FOR HYPERSPACE',
      note: 'PRESS EMPTY SKY TWICE: HYPERSPACE',
      options: [
        { value: 'nudge', label: 'NUDGE', tip: 'THE STAR IS SHOVED OFF ITS PATH AND SPRINGS BACK; ITS NEIGHBOURS STIR' },
        { value: 'laser', label: 'LASER', tip: 'A PULSE OF LIGHT FROM THE SIDE: THE STAR GLOWS, RECOILS AND COOLS' },
        { value: 'throw', label: 'THROW', tip: 'HOLD THE STAR, DRAG IT AND LET GO: IT FLIES ON AT THE SPEED OF YOUR HAND' },
        { value: 'pull', label: 'PULL', tip: 'THE STAR TURNS HEAVY FOR TWO SECONDS: THE STARS NEAR IT BEND TOWARDS IT, THEN SPRING BACK' },
        { value: 'burst', label: 'BURST', tip: 'THE STAR BREAKS INTO FAINT PIECES THAT SLOW AND FADE; A NEW STAR ARRIVES FAR OFF' },
        { value: 'tie', label: 'TIE', tip: 'PRESS ONE STAR, THEN ANOTHER: AN ELASTIC THREAD TIES THEM AND THEY TUG EACH OTHER FOR SIX SECONDS' },
        { value: 'off', label: 'OFF', tip: 'NOTHING HAPPENS TO A STAR: ONE PRESS ON THE SKY IS HYPERSPACE, AS BEFORE' },
      ],
    },
  ],
  widgets: [{ kind: 'pad', id: 'origin', tab: 'flight', label: 'WHERE THEY COME FROM', tip: 'THE POINT THE STARS RUSH OUT OF: THE MIDDLE OF THE PAD IS THE MIDDLE OF THE SCREEN', x: 'originX', y: 'originY' }],
  actions: [],
  defaults: DEFAULTS,
  looks: [],
  partyRests: [
    { key: 'spin', chance: 0.6 },
    { key: 'wind', chance: 0.7 },
    { key: 'fall', chance: 0.7 },
    { key: 'originX', chance: 0.6 },
    { key: 'originY', chance: 0.6 },
  ],
};

const look = (changes: Values): Values => parseValues(BASE, { ...DEFAULTS, ...changes });

export const STARFIELD_DEF: BackdropDef = {
  ...BASE,
  looks: [
    { id: '98', label: '98', tip: 'THE WINDOWS 98 SCREENSAVER, AS IT CAME', values: DEFAULTS },
    { id: 'warp', label: 'WARP', tip: 'FAST, STREAKED AND EVERY COLOUR', values: look({ stars: 500, speed: 85, warp: 80, colours: 'rainbow', twinkle: 0, spin: 15 }) },
    { id: 'snow', label: 'SNOW', tip: 'SLOW FLAKES FALLING ON A SIDE WIND', values: look({ stars: 320, speed: 0, fall: 35, wind: 15, size: 3, twinkle: 0, spread: 100, warp: 0 }) },
  ],
};
