/**
 * Smart Layer Tags: the behaviour library and the built-in tags, straight from the plan's tables. A tag is data on the project, so it saves
 * with it and can be shared as a small file (`exportTagPreset`).
 */
import { ROUGH_TINT, TAG_COLOURS } from './colours';
import type { BehaviourSet, BlendMode, LayerNode, Project, SmartName, Tag } from './types';

/** Everything off: the blank tag a custom one starts from. */
export function blankBehaviours(): BehaviourSet {
  return {
    paintBehindLines: false,
    stayInsideLines: false,
    closeGaps: { on: false, maxGapPx: 8 },
    showClosures: false,
    tuckUnder: false,
    protectLines: false,
    isFillReference: false,
    ignoredByFills: false,
    skipOnExport: false,
    onionSkin: { on: true, mode: 'tint' },
    dimWhenInactive: { on: false, tint: null },
    holdWholeShot: false,
    autoNewDrawing: true,
    clipToLayerBelow: false,
    carryColourForward: false,
    alwaysOnTop: false,
    startLocked: false,
    layerDefaults: { blend: 'normal', opacity: 1, stabiliser: null },
  };
}

function behaviours(change: Partial<BehaviourSet>): BehaviourSet {
  return { ...blankBehaviours(), ...change };
}

function tag(id: string, name: string, colour: string, mark: string, change: Partial<BehaviourSet>): Tag {
  return { id, name, colour, mark, builtin: true, on: true, behaviours: behaviours(change) };
}

export function builtinTags(): Tag[] {
  const defaults = (blend: BlendMode, stabiliser: number | null = null) => ({ blend, opacity: 1, stabiliser });
  return [
    tag('figure', 'FIGURE', TAG_COLOURS.figure, 'FIG', {
      paintBehindLines: true,
      stayInsideLines: true,
      closeGaps: { on: true, maxGapPx: 8 },
      showClosures: true,
      tuckUnder: true,
      protectLines: true,
    }),
    tag('ink', 'INK', TAG_COLOURS.ink, 'INK', { isFillReference: true, layerDefaults: defaults('normal', 0.5) }),
    tag('rough', 'ROUGH', TAG_COLOURS.rough, 'RGH', { ignoredByFills: true, skipOnExport: true, dimWhenInactive: { on: true, tint: ROUGH_TINT } }),
    tag('shade', 'SHADE', TAG_COLOURS.shade, 'SHD', { clipToLayerBelow: true, stayInsideLines: true, ignoredByFills: true, layerDefaults: defaults('multiply') }),
    tag('background', 'BACKGROUND', TAG_COLOURS.background, 'BG', { holdWholeShot: true, onionSkin: { on: false, mode: 'tint' }, ignoredByFills: true }),
    tag('reference', 'REFERENCE', TAG_COLOURS.reference, 'REF', {
      skipOnExport: true,
      ignoredByFills: true,
      dimWhenInactive: { on: true, tint: null },
      onionSkin: { on: false, mode: 'tint' },
      startLocked: true,
    }),
    tag('fx', 'FX', TAG_COLOURS.fx, 'FX', { ignoredByFills: true, layerDefaults: defaults('add') }),
    tag('notes', 'NOTES', TAG_COLOURS.notes, 'NOTE', { skipOnExport: true, alwaysOnTop: true, ignoredByFills: true, onionSkin: { on: false, mode: 'tint' } }),
  ];
}

/** The tag in force on a row: its own, or the nearest folder's. */
export function tagOf(project: Project, node: LayerNode): Tag | null {
  let at: LayerNode | null = node;
  while (at !== null) {
    if (at.tagId !== null) return project.tags.find((t) => t.id === at?.tagId) ?? null;
    const parent: string | null = at.parent;
    at = parent === null ? null : (project.nodes.find((n) => n.id === parent) ?? null);
  }
  return null;
}

/** The three levels of the off switch: the master key, the tag's own switch, and each behaviour's. */
export function liveBehaviours(project: Project, node: LayerNode, masterOn: boolean): BehaviourSet | null {
  const found = tagOf(project, node);
  if (found === null || !found.on || !masterOn) return null;
  return found.behaviours;
}

/** A layer with lines and colour apart: its tag paints behind its lines. */
export function isFigure(project: Project, node: LayerNode): boolean {
  return tagOf(project, node)?.behaviours.paintBehindLines === true;
}

/** Non-smart properties (hide a layer in renders, onion, hold) ask here: they follow the tag's switch but not the master key's. */
export function tagBehaviours(project: Project, node: LayerNode): BehaviourSet | null {
  const found = tagOf(project, node);
  return found !== null && found.on ? found.behaviours : null;
}

/** Which smarts a stroke will remember, given what is live. */
export function smartsForStroke(live: BehaviourSet | null): SmartName[] {
  if (live === null) return [];
  const out: SmartName[] = [];
  if (live.paintBehindLines) out.push('paintBehindLines');
  if (live.stayInsideLines) out.push('stayInsideLines');
  if (live.closeGaps.on) out.push('closeGaps');
  if (live.tuckUnder) out.push('tuckUnder');
  if (live.clipToLayerBelow) out.push('clipToLayerBelow');
  return out;
}

export function exportTagPreset(tags: Tag[]): string {
  return JSON.stringify({ animateTagPreset: 1, tags: tags.map((t) => ({ ...t, builtin: false })) }, null, 2);
}

const BLENDS: BlendMode[] = ['normal', 'multiply', 'screen', 'overlay', 'add'];

/** Behaviours from a file, taken field by field: anything missing or the wrong shape keeps the blank's value. */
function readBehaviours(raw: unknown): BehaviourSet {
  const blank = blankBehaviours();
  if (typeof raw !== 'object' || raw === null) return blank;
  const r = raw as Record<string, unknown>;
  const yes = (key: keyof BehaviourSet): boolean => (typeof r[key] === 'boolean' ? (r[key] as boolean) : (blank[key] as boolean));
  const obj = (key: string): Record<string, unknown> => (typeof r[key] === 'object' && r[key] !== null ? (r[key] as Record<string, unknown>) : {});
  const gap = obj('closeGaps');
  const onion = obj('onionSkin');
  const dim = obj('dimWhenInactive');
  const defaults = obj('layerDefaults');
  return {
    paintBehindLines: yes('paintBehindLines'),
    stayInsideLines: yes('stayInsideLines'),
    closeGaps: { on: gap.on === true, maxGapPx: typeof gap.maxGapPx === 'number' && gap.maxGapPx > 0 ? Math.min(100, gap.maxGapPx) : blank.closeGaps.maxGapPx },
    showClosures: yes('showClosures'),
    tuckUnder: yes('tuckUnder'),
    protectLines: yes('protectLines'),
    isFillReference: yes('isFillReference'),
    ignoredByFills: yes('ignoredByFills'),
    skipOnExport: yes('skipOnExport'),
    onionSkin: { on: onion.on !== false, mode: onion.mode === 'outline' ? 'outline' : 'tint' },
    dimWhenInactive: { on: dim.on === true, tint: typeof dim.tint === 'string' && /^#[0-9a-fA-F]{6}$/.test(dim.tint) ? dim.tint : null },
    holdWholeShot: yes('holdWholeShot'),
    autoNewDrawing: yes('autoNewDrawing'),
    clipToLayerBelow: yes('clipToLayerBelow'),
    carryColourForward: yes('carryColourForward'),
    alwaysOnTop: yes('alwaysOnTop'),
    startLocked: yes('startLocked'),
    layerDefaults: {
      blend: BLENDS.includes(defaults.blend as BlendMode) ? (defaults.blend as BlendMode) : 'normal',
      opacity: typeof defaults.opacity === 'number' ? Math.max(0, Math.min(1, defaults.opacity)) : 1,
      stabiliser: typeof defaults.stabiliser === 'number' ? Math.max(0, Math.min(1, defaults.stabiliser)) : null,
    },
  };
}

/** Tags read from a shared file. Anything not shaped like a tag is left out, and missing behaviours take the blank's. */
export function readTagPreset(text: string): Tag[] {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return [];
  }
  const list = (raw as { tags?: unknown } | null)?.tags;
  if (!Array.isArray(list)) return [];
  const out: Tag[] = [];
  for (const item of list) {
    const t = item as Partial<Tag> | null;
    if (t === null || typeof t !== 'object' || typeof t.name !== 'string' || typeof t.id !== 'string') continue;
    out.push({
      id: t.id,
      name: t.name.slice(0, 24),
      colour: typeof t.colour === 'string' && /^#[0-9a-fA-F]{6}$/.test(t.colour) ? t.colour : TAG_COLOURS.notes,
      mark: typeof t.mark === 'string' ? t.mark.slice(0, 4) : t.name.slice(0, 3).toUpperCase(),
      builtin: false,
      on: t.on !== false,
      behaviours: readBehaviours(t.behaviours),
    });
  }
  return out;
}
