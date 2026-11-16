import { parseValues, type BackdropDef, type Values } from '../knobs';

/**
 * FLUID's knobs (SPEC-backgrounds.md): the ink, the water it is in, how it is drawn, and what the pointer does. As it comes it
 * is slow coloured ink that the pointer stirs, with a splat by itself every few seconds.
 */

const DEFAULTS: Values = {
  splat: 5,
  push: 50,
  fade: 80,
  auto: 45,
  colours: 'dyes',
  thickness: 20,
  swirl: 35,
  buoyancy: 0,
  windX: 0,
  windY: 0,
  walls: true,
  cell: 10,
  steps: 4,
  dither: 60,
  mirror: 'off',
  pointer: 'stir',
  time: 1,
};

const BASE: BackdropDef = {
  id: 'fluid',
  label: 'FLUID',
  tabs: [
    { id: 'ink', label: 'INK' },
    { id: 'water', label: 'WATER' },
    { id: 'look', label: 'LOOK' },
  ],
  knobs: [
    {
      kind: 'choice',
      key: 'pointer',
      tab: 'ink',
      label: 'POINTER',
      tip: 'WHAT YOUR POINTER DOES TO THE WATER',
      options: [
        { value: 'stir', label: 'STIR', tip: 'IT DRAGS THE WATER AND LEAVES INK' },
        { value: 'ignore', label: 'IGNORE', tip: 'THE WATER TAKES NO NOTICE' },
      ],
    },
    { kind: 'range', key: 'splat', tab: 'ink', label: 'SPLAT SIZE', tip: 'HOW BIG A BLOT OF INK IS', min: 2, max: 14, step: 1, unit: '', party: [3, 9] },
    { kind: 'range', key: 'push', tab: 'ink', label: 'PUSH', tip: 'HOW HARD A SPLAT AND THE POINTER SHOVE THE WATER', min: 0, max: 100, step: 5, unit: '%', party: [25, 100] },
    { kind: 'range', key: 'fade', tab: 'ink', label: 'INK LASTS', tip: 'HOW LONG INK STAYS BEFORE IT FADES', min: 0, max: 100, step: 5, unit: '%', party: [35, 95] },
    { kind: 'range', key: 'auto', tab: 'ink', label: 'AUTO SPLATS', tip: 'HOW OFTEN INK ARRIVES BY ITSELF', min: 0, max: 100, step: 5, unit: '%', party: [10, 70] },
    {
      kind: 'choice',
      key: 'colours',
      tab: 'ink',
      label: 'COLOURS',
      tip: 'WHICH THREE INKS THERE ARE',
      party: true,
      options: [
        { value: 'dyes', label: 'DYES', tip: 'PINK, BLUE AND YELLOW' },
        { value: 'fire', label: 'FIRE', tip: 'YELLOW, ORANGE AND RED' },
        { value: 'sea', label: 'SEA', tip: 'BLUES AND MINT' },
        { value: 'mono', label: 'MONO', tip: 'WHITE AND GREY' },
        { value: 'rainbow', label: 'RAINBOW', tip: 'RED, GREEN AND BLUE, WHICH MIX TO EVERYTHING' },
      ],
    },
    { kind: 'range', key: 'thickness', tab: 'water', label: 'THICKNESS', tip: 'HOW SOON THE WATER STOPS MOVING', min: 0, max: 100, step: 5, unit: '%', party: [0, 60] },
    { kind: 'range', key: 'swirl', tab: 'water', label: 'SWIRL', tip: 'HOW TIGHTLY THE WATER CURLS: THE ONE THAT CHANGES ITS CHARACTER', min: 0, max: 100, step: 5, unit: '%' },
    { kind: 'range', key: 'buoyancy', tab: 'water', label: 'BUOYANCY', tip: 'INK RISES (+) OR SINKS (-)', min: -100, max: 100, step: 5, unit: '', signed: true, party: [-60, 60] },
    { kind: 'range', key: 'windX', tab: 'water', label: 'WIND ACROSS', tip: 'BLOWS THE INK LEFT (-) OR RIGHT (+)', min: -100, max: 100, step: 5, unit: '', signed: true, party: [-50, 50] },
    { kind: 'range', key: 'windY', tab: 'water', label: 'WIND DOWN', tip: 'BLOWS THE INK UP (-) OR DOWN (+)', min: -100, max: 100, step: 5, unit: '', signed: true, party: [-50, 50] },
    { kind: 'switch', key: 'walls', tab: 'water', label: 'WINDOWS ARE SOLID', tip: 'THE WATER GOES ROUND THE SITE WINDOW, NOT UNDER IT', party: 0 },
    { kind: 'range', key: 'time', tab: 'water', label: 'TIME', tip: 'EVERYTHING SLOWER OR FASTER', min: 0.25, max: 3, step: 0.25, unit: 'x', party: [0.5, 2] },
    { kind: 'range', key: 'cell', tab: 'look', label: 'GRID', tip: 'HOW BIG A SQUARE OF WATER IS ON THE SCREEN. CHANGING IT STARTS THE WATER AGAIN', min: 6, max: 24, step: 2, unit: 'px', party: [8, 16] },
    { kind: 'range', key: 'steps', tab: 'look', label: 'COLOUR STEPS', tip: 'HOW MANY SHADES EACH INK IS CUT TO', min: 2, max: 8, step: 1, unit: '' },
    { kind: 'range', key: 'dither', tab: 'look', label: 'DITHER', tip: 'HOW MUCH THE SHADES ARE SPECKLED INTO ONE ANOTHER', min: 0, max: 100, step: 5, unit: '%' },
    {
      kind: 'choice',
      key: 'mirror',
      tab: 'look',
      label: 'KALEIDOSCOPE',
      tip: 'THE PICTURE FOLDED OVER ON ITSELF',
      party: true,
      options: [
        { value: 'off', label: 'OFF', tip: 'THE WATER AS IT IS' },
        { value: '2', label: '2', tip: 'LEFT AND RIGHT THE SAME' },
        { value: '4', label: '4', tip: 'ALL FOUR CORNERS THE SAME' },
        { value: '8', label: '8', tip: 'EIGHT WEDGES THE SAME' },
      ],
    },
  ],
  widgets: [{ kind: 'pad', id: 'wind', tab: 'water', label: 'WIND', tip: 'WHICH WAY THE INK IS BLOWN, AND HOW HARD: THE MIDDLE IS STILL AIR', x: 'windX', y: 'windY' }],
  actions: [
    { id: 'splat', tab: 'ink', label: 'SPLAT', tip: 'A BURST OF INK IN RANDOM PLACES' },
    { id: 'calm', tab: 'water', label: 'CALM', tip: 'STILLS THE WATER: THE INK STAYS WHERE IT IS' },
    { id: 'clear', tab: 'ink', label: 'CLEAR', tip: 'CLEAN, STILL WATER' },
  ],
  defaults: DEFAULTS,
  looks: [],
  partyRests: [
    { key: 'windX', chance: 0.6 },
    { key: 'windY', chance: 0.6 },
    { key: 'buoyancy', chance: 0.5 },
    { key: 'mirror', chance: 0.6 },
  ],
};

const look = (changes: Values): Values => parseValues(BASE, { ...DEFAULTS, ...changes });

export const FLUID_DEF: BackdropDef = {
  ...BASE,
  looks: [
    { id: 'ink', label: 'INK', tip: 'COLOURED INK IN STILL WATER, AS IT COMES', values: DEFAULTS },
    { id: 'smoke', label: 'SMOKE', tip: 'GREY SMOKE THAT RISES AND CURLS', values: look({ colours: 'mono', buoyancy: 60, fade: 45, swirl: 65, thickness: 10, auto: 45, steps: 5, splat: 6 }) },
    { id: 'lava', label: 'LAVA', tip: 'THICK, SLOW AND HOT', values: look({ colours: 'fire', buoyancy: 25, thickness: 60, fade: 90, swirl: 10, steps: 3, dither: 100, splat: 8, time: 0.75 }) },
    { id: 'oil-slick', label: 'OIL SLICK', tip: 'EVERY COLOUR, TIGHTLY CURLED, FOLDED FOUR WAYS', values: look({ colours: 'rainbow', swirl: 85, fade: 90, thickness: 5, steps: 6, mirror: '4', auto: 35 }) },
  ],
};
