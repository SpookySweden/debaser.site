import { parseValues, type BackdropDef, type Values } from '../knobs';

/**
 * SAND's knobs (SPEC-backgrounds.md): what is poured and how, the world it falls through, fire and growing things, and how it
 * looks. As it comes it is a light fall of sand that goes through an open floor, so it only gathers where the page holds it up.
 */

const DEFAULTS: Values = {
  grain: 'sand',
  brush: 3,
  pour: 60,
  rain: 20,
  rainOf: 'sand',
  rainWide: 100,
  drain: true,
  solid: true,
  sift: 15,
  gravity: 100,
  wind: 0,
  flow: 4,
  evaporate: 0,
  fireSpread: 40,
  fireLife: 30,
  grow: 20,
  cell: 4,
  colours: 'dyes',
  speckle: 50,
  time: 1,
};

const BASE: BackdropDef = {
  id: 'sand',
  label: 'SAND',
  tabs: [
    { id: 'pour', label: 'POUR' },
    { id: 'world', label: 'WORLD' },
    { id: 'life', label: 'FIRE AND LIFE' },
    { id: 'look', label: 'LOOK' },
  ],
  knobs: [
    {
      kind: 'choice',
      key: 'grain',
      tab: 'pour',
      label: 'GRAIN',
      tip: 'WHAT YOU POUR: HOLD THE POINTER DOWN ON THE BARE BACKGROUND',
      options: [
        { value: 'sand', label: 'SAND', tip: 'PILES UP AND SLIDES' },
        { value: 'water', label: 'WATER', tip: 'RUNS AND FINDS ITS LEVEL' },
        { value: 'stone', label: 'STONE', tip: 'STAYS WHERE YOU PUT IT' },
        { value: 'plant', label: 'PLANT', tip: 'DRINKS WATER AND GROWS; BURNS' },
        { value: 'fire', label: 'FIRE', tip: 'EATS PLANT AND OIL, LEAVES SMOKE; WATER PUTS IT OUT' },
        { value: 'oil', label: 'OIL', tip: 'FLOATS ON WATER; BURNS' },
        { value: 'erase', label: 'RUB OUT', tip: 'TAKES AWAY WHATEVER IS THERE' },
      ],
    },
    { kind: 'range', key: 'brush', tab: 'pour', label: 'BRUSH', tip: 'HOW WIDE YOU POUR, IN GRAINS', min: 1, max: 12, step: 1, unit: '', party: [2, 6] },
    { kind: 'range', key: 'pour', tab: 'pour', label: 'POUR', tip: 'HOW THICK AND FAST IT COMES', min: 10, max: 100, step: 5, unit: '%' },
    { kind: 'range', key: 'rain', tab: 'pour', label: 'RAIN', tip: 'HOW MUCH FALLS BY ITSELF', min: 0, max: 100, step: 1, unit: '%', party: [4, 45] },
    {
      kind: 'choice',
      key: 'rainOf',
      tab: 'pour',
      label: 'RAIN OF',
      tip: 'WHAT FALLS BY ITSELF',
      party: true,
      options: [
        { value: 'sand', label: 'SAND', tip: 'SAND' },
        { value: 'water', label: 'WATER', tip: 'WATER' },
        { value: 'oil', label: 'OIL', tip: 'OIL' },
        { value: 'plant', label: 'SEEDS', tip: 'BITS OF PLANT' },
        { value: 'fire', label: 'SPARKS', tip: 'FIRE' },
        { value: 'mix', label: 'MIX', tip: 'A BIT OF EVERYTHING' },
      ],
    },
    { kind: 'range', key: 'rainWide', tab: 'pour', label: 'RAIN WIDTH', tip: 'HOW MUCH OF THE WIDTH IT FALLS ACROSS, ROUND THE MIDDLE', min: 5, max: 100, step: 5, unit: '%', party: [20, 100] },
    { kind: 'switch', key: 'drain', tab: 'world', label: 'OPEN FLOOR', tip: 'GRAINS FALL OUT OF THE BOTTOM, SO IT NEVER FILLS UP', party: 0 },
    { kind: 'switch', key: 'solid', tab: 'world', label: 'WINDOWS ARE SOLID', tip: 'THE SITE WINDOW AND THE OTHER WINDOWS HOLD GRAINS UP', party: 0 },
    { kind: 'range', key: 'sift', tab: 'world', label: 'SIFT', tip: 'HOW FAST A HEAP SIFTS AWAY THROUGH THE WINDOW IT RESTS ON', min: 0, max: 100, step: 5, unit: '%', party: [10, 60] },
    { kind: 'range', key: 'wind', tab: 'world', label: 'WIND', tip: 'BLOWS EVERYTHING LEFT (-) OR RIGHT (+)', min: -100, max: 100, step: 5, unit: '', signed: true, party: [-60, 60] },
    { kind: 'range', key: 'gravity', tab: 'world', label: 'GRAVITY', tip: 'HOW HARD THINGS FALL. BELOW NOTHING THEY FALL UPWARDS', min: -100, max: 100, step: 5, unit: '', signed: true, party: [40, 100] },
    { kind: 'range', key: 'flow', tab: 'world', label: 'WATER RUNS', tip: 'HOW RUNNY WATER IS', min: 1, max: 8, step: 1, unit: '' },
    { kind: 'range', key: 'evaporate', tab: 'world', label: 'EVAPORATE', tip: 'HOW FAST OPEN WATER DRIES UP', min: 0, max: 100, step: 5, unit: '%', party: [0, 30] },
    { kind: 'range', key: 'fireSpread', tab: 'life', label: 'FIRE SPREADS', tip: 'HOW EASILY FIRE CATCHES PLANT AND OIL', min: 0, max: 100, step: 5, unit: '%' },
    { kind: 'range', key: 'fireLife', tab: 'life', label: 'FIRE LASTS', tip: 'HOW LONG A FLAME BURNS', min: 5, max: 100, step: 5, unit: '' },
    { kind: 'range', key: 'grow', tab: 'life', label: 'PLANT GROWS', tip: 'HOW FAST PLANT SPREADS THROUGH WATER', min: 0, max: 100, step: 5, unit: '%' },
    { kind: 'range', key: 'cell', tab: 'look', label: 'GRAIN SIZE', tip: 'HOW BIG A GRAIN IS ON THE SCREEN. CHANGING IT STARTS THE SAND AGAIN', min: 2, max: 8, step: 1, unit: 'px', party: [3, 6] },
    {
      kind: 'choice',
      key: 'colours',
      tab: 'look',
      label: 'COLOURS',
      tip: 'WHICH DYES THE GRAINS ARE',
      party: true,
      options: [
        { value: 'dyes', label: 'DYES', tip: "THE SITE'S OWN" },
        { value: 'desert', label: 'DESERT', tip: 'PAPER, RUST AND MINT' },
        { value: 'neon', label: 'NEON', tip: 'PINK, LIME AND BLUE' },
        { value: 'mono', label: 'MONO', tip: 'WHITE AND GREY' },
      ],
    },
    { kind: 'range', key: 'speckle', tab: 'look', label: 'SPECKLE', tip: 'HOW MUCH ONE GRAIN DIFFERS FROM THE NEXT', min: 0, max: 100, step: 5, unit: '%' },
    { kind: 'range', key: 'time', tab: 'look', label: 'TIME', tip: 'EVERYTHING SLOWER OR FASTER', min: 0.25, max: 3, step: 0.25, unit: 'x', party: [0.5, 2] },
  ],
  widgets: [{ kind: 'pad', id: 'air', tab: 'world', label: 'WIND AND GRAVITY', tip: 'ACROSS: THE WIND, LEFT OR RIGHT. DOWN: HOW HARD THINGS FALL (ABOVE THE MIDDLE THEY FALL UPWARDS)', x: 'wind', y: 'gravity' }],
  actions: [
    { id: 'shake', tab: 'pour', label: 'SHAKE', tip: 'EVERYTHING LOOSE JUMPS' },
    { id: 'clear', tab: 'pour', label: 'CLEAR', tip: 'AN EMPTY SCREEN' },
    { id: 'flood', tab: 'world', label: 'FLOOD', tip: 'WATER FILLS THE BOTTOM THIRD' },
    { id: 'burn', tab: 'life', label: 'BURN', tip: 'SETS LIGHT TO THE PLANT AND THE OIL' },
  ],
  defaults: DEFAULTS,
  looks: [],
  partyRests: [
    { key: 'wind', chance: 0.5 },
    { key: 'evaporate', chance: 0.6 },
  ],
};

const look = (changes: Values): Values => parseValues(BASE, { ...DEFAULTS, ...changes });

export const SAND_DEF: BackdropDef = {
  ...BASE,
  looks: [
    { id: 'dunes', label: 'DUNES', tip: 'A LIGHT FALL OF SAND, AS IT COMES', values: DEFAULTS },
    { id: 'rainstorm', label: 'RAINSTORM', tip: 'HARD RAIN ON A SLANT', values: look({ rainOf: 'water', rain: 55, wind: 45, flow: 6, evaporate: 10, sift: 50, grain: 'water' }) },
    { id: 'forest-fire', label: 'FOREST FIRE', tip: 'SEEDS, WATER AND SPARKS: IT GROWS AND IT BURNS', values: look({ rainOf: 'mix', rain: 22, grow: 70, fireSpread: 75, fireLife: 45, drain: false, sift: 60, grain: 'fire' }) },
    { id: 'hourglass', label: 'HOURGLASS', tip: 'ONE THIN STREAM DOWN THE MIDDLE', values: look({ rain: 60, rainWide: 5, sift: 15, colours: 'desert', speckle: 80 }) },
  ],
};
