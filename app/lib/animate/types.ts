/**
 * ANIMATE's project as data (SPEC-animator.md). Plain JSON all the way down, so a project can be held immutably (undo keeps old
 * copies by reference), written to IndexedDB and saved in a project file with nothing to convert.
 */

export type PlaneName = 'line' | 'colour';
export type BrushId = 'pencil' | 'ink' | 'flat' | 'eraser' | 'fill' | 'fillbrush' | 'filleraser';
export type BlendMode = 'normal' | 'multiply' | 'screen' | 'overlay' | 'add';
export type CelMark = 'key' | 'breakdown' | 'inbetween';
export type OnionMode = 'tint' | 'outline';
export type PlayMode = 'loop' | 'pingpong' | 'once';

/** The behaviours a stroke can remember were on when it was drawn. */
export type SmartName = 'paintBehindLines' | 'stayInsideLines' | 'closeGaps' | 'tuckUnder' | 'clipToLayerBelow';

/** One pen point: x, y in drawing pixels, pressure 0 to 1 (after the pressure curve and tilt). */
export type StrokePoint = [number, number, number];

export type Stroke = {
  kind: 'stroke';
  id: string;
  plane: PlaneName;
  brush: BrushId;
  colour: string;
  size: number;
  opacity: number;
  points: StrokePoint[];
  /** True for a mouse: no real pressure, so width follows speed. */
  simulated?: boolean;
  smartAtDrawTime: SmartName[];
  /** The region the stroke started in, when it was clipped to one. Worked out again if the lines change. */
  regionId?: number | null;
  /** The gap size in force when it was drawn, so a re-clip reads the same closures. */
  maxGapPx?: number;
};

/** A bucket fill: the seed is where it was pressed; the area is worked out from it. */
export type FillOp = {
  kind: 'fill';
  id: string;
  plane: PlaneName;
  colour: string;
  /** `clear` removes colour from the area rather than laying it down (the fill eraser). */
  clear?: boolean;
  seed: [number, number];
  smartAtDrawTime: SmartName[];
  regionId?: number | null;
  maxGapPx?: number;
  /** A fill made with smarts off keeps the exact rows it filled (row, from x, to x, ...), so it never moves. */
  runs?: number[];
};

/** A selection moved: what the shape held is lifted and put down through the matrix. */
export type MoveOp = {
  kind: 'move';
  id: string;
  plane: PlaneName;
  /** The selection outline, in drawing pixels. */
  outline: [number, number][];
  /** a, b, c, d, e, f of a canvas transform. */
  matrix: [number, number, number, number, number, number];
};

/** An image placed on a plane (the Reference tag's imported pictures). The file is `assets/<assetId>`. */
export type ImageOp = {
  kind: 'image';
  id: string;
  plane: PlaneName;
  assetId: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

/** The plane wiped. */
export type ClearOp = { kind: 'clear'; id: string; plane: PlaneName };

export type PlaneOp = Stroke | FillOp | MoveOp | ImageOp | ClearOp;

export type Drawing = {
  id: string;
  planes: Record<PlaneName, PlaneOp[]>;
};

/** A drawing on a layer's timeline: it starts on `frame` and is exposed for `length` frames. */
export type Cel = {
  id: string;
  frame: number;
  length: number;
  drawingId: string;
  mark: CelMark;
};

export type LayerNode = {
  id: string;
  kind: 'layer' | 'folder';
  /** The folder this sits in, or null at the top. */
  parent: string | null;
  name: string;
  visible: boolean;
  locked: boolean;
  solo: boolean;
  opacity: number;
  blend: BlendMode;
  /** A colour label on the row, or null. */
  label: string | null;
  /** A tag on this row; null on a layer means it takes its folder's. */
  tagId: string | null;
  /** Folders only: its rows are hidden in the list and the timeline. */
  collapsed: boolean;
  /** Layers only, sorted by frame, never overlapping. Empty on a folder. */
  cels: Cel[];
  /** A Figure's two planes can be hidden and locked apart. */
  planeHidden: Record<PlaneName, boolean>;
  planeLocked: Record<PlaneName, boolean>;
};

export type BehaviourSet = {
  paintBehindLines: boolean;
  stayInsideLines: boolean;
  closeGaps: { on: boolean; maxGapPx: number };
  showClosures: boolean;
  tuckUnder: boolean;
  protectLines: boolean;
  isFillReference: boolean;
  ignoredByFills: boolean;
  skipOnExport: boolean;
  onionSkin: { on: boolean; mode: OnionMode };
  dimWhenInactive: { on: boolean; tint: string | null };
  holdWholeShot: boolean;
  autoNewDrawing: boolean;
  clipToLayerBelow: boolean;
  carryColourForward: boolean;
  alwaysOnTop: boolean;
  startLocked: boolean;
  /** What a new layer with this tag starts with. */
  layerDefaults: { blend: BlendMode; opacity: number; stabiliser: number | null };
};

export type Tag = {
  id: string;
  name: string;
  colour: string;
  /** A short text mark for the chip; code draws no icons. */
  mark: string;
  builtin: boolean;
  /** The per-tag switch: off leaves the tag on its layers with its smarts asleep. */
  on: boolean;
  behaviours: BehaviourSet;
};

export type OnionSide = {
  count: number;
  colour: string;
  /** One opacity per neighbour, nearest first (0 to 1). */
  opacities: number[];
};

export type OnionSettings = {
  on: boolean;
  prev: OnionSide;
  next: OnionSide;
  mode: OnionMode;
  keysOnly: boolean;
  includeCurrent: boolean;
};

export type Swatch = { name: string; colour: string };

export type AudioTrack = {
  assetId: string;
  name: string;
  /** Which frame the sound starts on. */
  frame: number;
  volume: number;
};

export type Project = {
  format: 1;
  id: string;
  name: string;
  width: number;
  height: number;
  fps: number;
  background: string;
  safeArea: boolean;
  /** How many frames the shot runs. */
  frames: number;
  /** The playback range, inclusive, or null for all of it. */
  range: { in: number; out: number } | null;
  playMode: PlayMode;
  nodes: LayerNode[];
  drawings: Record<string, Drawing>;
  tags: Tag[];
  palette: Swatch[];
  onion: OnionSettings;
  audio: AudioTrack | null;
  /** Every id handed out is this counter, so ids stay short and never repeat inside a project. */
  nextId: number;
};
