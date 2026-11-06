/**
 * What the panels read. The engine (`engine.ts`) does the work and writes here; each panel reads only the bit it draws, so a stroke or a
 * playing frame doesn't re-render the page (the same rule as the site's windows).
 */
import { create } from 'zustand';
import { DEFAULT_BRUSHES, LINEAR_CURVE, type BrushSettings, type PressureCurve } from './brushes';
import { DEFAULT_INK } from './colours';
import { createProject } from './project';
import type { BrushId, PlaneName, Project } from './types';

export type ToolId = BrushId | 'lasso' | 'rect' | 'pick' | 'hand' | 'shift';

export type Settings = {
  uiScale: number;
  full: boolean;
  /** How big the brush ring and other marks over the drawing are. */
  cursorScale: number;
  pressure: PressureCurve;
  tilt: boolean;
  lowLatency: boolean;
  autosaveSeconds: number;
  keepVersions: number;
  /** New drawings on 1s, 2s, 3s. */
  defaultHold: number;
  showThumbnails: boolean;
  leftHanded: boolean;
  /** Action id to key, for every action the person has moved. */
  shortcuts: Record<string, string>;
  defaultGap: number;
  bigBadge: boolean;
};

export const DEFAULT_SETTINGS: Settings = {
  uiScale: 1,
  full: false,
  cursorScale: 1,
  pressure: LINEAR_CURVE,
  tilt: true,
  lowLatency: true,
  autosaveSeconds: 10,
  keepVersions: 3,
  defaultHold: 1,
  showThumbnails: true,
  leftHanded: false,
  shortcuts: {},
  defaultGap: 8,
  bigBadge: true,
};

const SETTINGS_KEY = 'debaser.animate.settings';
export const UI_SCALES = [1, 1.25, 1.5, 2, 2.5, 3];

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw !== null) return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    // A blocked store: the defaults do.
  }
  return DEFAULT_SETTINGS;
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Settings just last this visit.
  }
}

export type SaveState = 'saved' | 'saving' | 'failed' | 'waiting';
export type Panel = 'none' | 'settings' | 'keys' | 'projects' | 'export' | 'tags' | 'help' | 'onion';

export type StudioState = {
  project: Project;
  ready: boolean;
  frame: number;
  layerId: string;
  plane: PlaneName;
  tool: ToolId;
  colour: string;
  brushes: Record<BrushId, BrushSettings>;
  settings: Settings;
  /** The master toggle: smarts on or off. */
  smartOn: boolean;
  playing: boolean;
  /** Getting frames ready for playback: 0 to 1, or null. */
  readying: number | null;
  lightTable: boolean;
  canUndo: boolean;
  canRedo: boolean;
  saveState: SaveState;
  /** True when something has changed since the last project file was saved. */
  fileDirty: boolean;
  /** The one line of feedback under the stage. Faults stay until the next thing happens. */
  notice: { text: string; fault: boolean } | null;
  panel: Panel;
  /** A view readout for the strip: percent. */
  zoomPercent: number;
  /** A selection exists. */
  hasSelection: boolean;
  /** Strokes picked by the selection, for MAKE SMART. */
  selectedStrokes: number;
  shiftTraceOn: boolean;
};

export const useStudio = create<StudioState>(() => ({
  project: createProject('p_new'),
  ready: false,
  frame: 0,
  layerId: 'n_1',
  plane: 'line',
  tool: 'ink',
  colour: DEFAULT_INK,
  brushes: DEFAULT_BRUSHES,
  settings: DEFAULT_SETTINGS,
  smartOn: true,
  playing: false,
  readying: null,
  lightTable: false,
  canUndo: false,
  canRedo: false,
  saveState: 'saved',
  fileDirty: false,
  notice: null,
  panel: 'none',
  zoomPercent: 100,
  hasSelection: false,
  selectedStrokes: 0,
  shiftTraceOn: false,
}));

export function loadStoredSettings(): void {
  useStudio.setState({ settings: loadSettings() });
}

export function updateSettings(change: Partial<Settings>): void {
  const settings = { ...useStudio.getState().settings, ...change };
  useStudio.setState({ settings });
  saveSettings(settings);
}
