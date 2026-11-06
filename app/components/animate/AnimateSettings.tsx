'use client';

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { allActions, keyLabel, keyName, keyOf, setKeyCapture } from '../../lib/animate/actions';
import { LINEAR_CURVE, applyCurve, type PressureCurve } from '../../lib/animate/brushes';
import { getEngine } from '../../lib/animate/engine';
import { saveBlobAs } from '../../lib/animate/project-file';
import { UI_SCALES, updateSettings, useStudio } from '../../lib/animate/store';
import { PLATE_MEDIUM, PLATE_PRESSED } from '../../lib/ui/controls';
import { AnimatePanelFrame } from './AnimatePanels';
import AnimateSlider from './AnimateSlider';

const CURVE_SIZE = 160;
const SOFT_CURVE: PressureCurve = [0.1, 0.5, 0.45, 0.9];
const FIRM_CURVE: PressureCurve = [0.55, 0.1, 0.9, 0.5];

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-3 flex flex-col gap-1.5">
      <h3 className="text-accent-ink">{title}</h3>
      {children}
    </section>
  );
}

function Check({ label, on, onChange }: { label: string; on: boolean; onChange: (on: boolean) => void }) {
  return (
    <label className="flex items-center gap-2">
      <input type="checkbox" checked={on} onChange={(event) => onChange(event.target.checked)} />
      {label}
    </label>
  );
}

/** The pen's pressure curve: two handles to drag, and the same four numbers as sliders for the keyboard. */
function CurveEditor() {
  const curve = useStudio((state) => state.settings.pressure);
  const box = useRef<SVGSVGElement>(null);
  const [x1, y1, x2, y2] = curve;
  const px = (v: number) => v * CURVE_SIZE;
  const py = (v: number) => CURVE_SIZE - v * CURVE_SIZE;

  const drag = (event: ReactPointerEvent<SVGCircleElement>, which: 0 | 1) => {
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    const onMove = (move: PointerEvent) => {
      const rect = box.current?.getBoundingClientRect();
      if (rect === undefined) return;
      const hx = Math.max(0, Math.min(1, (move.clientX - rect.left) / rect.width));
      const hy = Math.max(0, Math.min(1, 1 - (move.clientY - rect.top) / rect.height));
      const now = useStudio.getState().settings.pressure;
      updateSettings({ pressure: which === 0 ? [hx, hy, now[2], now[3]] : [now[0], now[1], hx, hy] });
    };
    const onUp = () => {
      target.removeEventListener('pointermove', onMove);
      target.removeEventListener('pointerup', onUp);
      target.removeEventListener('pointercancel', onUp);
    };
    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerup', onUp);
    target.addEventListener('pointercancel', onUp);
  };

  const set = (at: number, value: number) => updateSettings({ pressure: curve.map((old, i) => (i === at ? value : old)) as PressureCurve });
  const samples = [0.25, 0.5, 0.75].map((p) => `${Math.round(p * 100)}% > ${Math.round(applyCurve(p, curve) * 100)}%`).join('  ');

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <span>CURVE</span>
        <button type="button" className={PLATE_MEDIUM} onClick={() => updateSettings({ pressure: SOFT_CURVE })}>
          [ SOFT ]
        </button>
        <button type="button" className={PLATE_MEDIUM} onClick={() => updateSettings({ pressure: LINEAR_CURVE })}>
          [ EVEN ]
        </button>
        <button type="button" className={PLATE_MEDIUM} onClick={() => updateSettings({ pressure: FIRM_CURVE })}>
          [ FIRM ]
        </button>
      </div>
      <svg ref={box} viewBox={`0 0 ${CURVE_SIZE} ${CURVE_SIZE}`} width={CURVE_SIZE} height={CURVE_SIZE} role="img" aria-label="Pressure curve" className="touch-none border-line border-ink bg-paper">
        <line x1={0} y1={CURVE_SIZE} x2={CURVE_SIZE} y2={0} stroke="var(--color-ink)" strokeDasharray="4 4" strokeOpacity={0.5} />
        <path d={`M 0 ${CURVE_SIZE} C ${px(x1)} ${py(y1)}, ${px(x2)} ${py(y2)}, ${CURVE_SIZE} 0`} fill="none" stroke="var(--color-bubble)" strokeWidth={3} />
        <line x1={0} y1={CURVE_SIZE} x2={px(x1)} y2={py(y1)} stroke="var(--color-ink)" />
        <line x1={CURVE_SIZE} y1={0} x2={px(x2)} y2={py(y2)} stroke="var(--color-ink)" />
        <circle cx={px(x1)} cy={py(y1)} r={9} fill="var(--color-sun)" stroke="var(--color-ink-plate)" strokeWidth={2} className="cursor-grab" onPointerDown={(event) => drag(event, 0)} />
        <circle cx={px(x2)} cy={py(y2)} r={9} fill="var(--color-sun)" stroke="var(--color-ink-plate)" strokeWidth={2} className="cursor-grab" onPointerDown={(event) => drag(event, 1)} />
      </svg>
      <span>{samples}</span>
      <div className="grid grid-cols-2 gap-x-2">
        <AnimateSlider label="HANDLE 1 ACROSS" min={0} max={1} step={0.05} value={x1} percent onChange={(v) => set(0, v)} />
        <AnimateSlider label="HANDLE 1 UP" min={0} max={1} step={0.05} value={y1} percent onChange={(v) => set(1, v)} />
        <AnimateSlider label="HANDLE 2 ACROSS" min={0} max={1} step={0.05} value={x2} percent onChange={(v) => set(2, v)} />
        <AnimateSlider label="HANDLE 2 UP" min={0} max={1} step={0.05} value={y2} percent onChange={(v) => set(3, v)} />
      </div>
    </div>
  );
}

/** Every action, each with its key. Press the key button, then the new key. */
function ShortcutList() {
  const shortcuts = useStudio((state) => state.settings.shortcuts);
  const [waiting, setWaiting] = useState<string | null>(null);
  const [told, setTold] = useState<string | null>(null);
  const importFile = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (waiting === null) return undefined;
    const onKey = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === 'Escape') {
        setWaiting(null);
        return;
      }
      if (['Control', 'Shift', 'Alt', 'Meta'].includes(event.key)) return;
      const name = keyName(event);
      const next = { ...useStudio.getState().settings.shortcuts, [waiting]: name };
      // A key does one thing: whatever had it loses it, and says so.
      const other = allActions().find((action) => action.id !== waiting && keyOf(action) === name);
      if (other !== undefined) {
        next[other.id] = '';
        setTold(`${keyLabel(name)} WAS ${other.label}, WHICH NOW HAS NO KEY`);
      } else {
        setTold(null);
      }
      updateSettings({ shortcuts: next });
      setWaiting(null);
    };
    setKeyCapture(true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      setKeyCapture(false);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [waiting]);

  const groups = new Map<string, ReturnType<typeof allActions>>();
  for (const action of allActions()) groups.set(action.group, [...(groups.get(action.group) ?? []), action]);

  return (
    <div className="flex flex-col gap-1.5" data-animate-shortcuts>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={PLATE_MEDIUM}
          onClick={() => void saveBlobAs(new Blob([JSON.stringify({ animateKeys: 1, shortcuts }, null, 2)], { type: 'application/json' }), 'animate-keys.json', 'Key set', ['.json'])}
        >
          [ SAVE KEY SET ]
        </button>
        <button type="button" className={PLATE_MEDIUM} onClick={() => importFile.current?.click()}>
          [ LOAD KEY SET ]
        </button>
        <button type="button" className={PLATE_MEDIUM} onClick={() => updateSettings({ shortcuts: {} })}>
          [ ALL BACK TO START ]
        </button>
        <input
          ref={importFile}
          type="file"
          accept=".json"
          className="sr-only"
          tabIndex={-1}
          aria-label="Load a key set"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file === undefined) return;
            void file.text().then((text) => {
              try {
                const read = (JSON.parse(text) as { shortcuts?: Record<string, unknown> }).shortcuts ?? {};
                const clean = Object.fromEntries(Object.entries(read).filter(([, value]) => typeof value === 'string')) as Record<string, string>;
                updateSettings({ shortcuts: clean });
                setTold('KEY SET LOADED');
              } catch {
                setTold('THAT IS NOT A KEY SET');
              }
            });
          }}
        />
      </div>
      {told !== null && <p role="status">{told}</p>}
      {[...groups.entries()].map(([group, actions]) => (
        <div key={group}>
          <h4 className="text-accent-ink">{group}</h4>
          <ul>
            {actions.map((action) => (
              <li key={action.id} className="flex items-center justify-between gap-2 border-b border-ink">
                <span className="min-w-0 flex-1 truncate" title={action.label}>
                  {action.label}
                </span>
                <button
                  type="button"
                  className={waiting === action.id ? PLATE_PRESSED : PLATE_MEDIUM}
                  aria-label={`Change the key for ${action.label}`}
                  data-animate-remap={action.id}
                  onClick={() => setWaiting(action.id)}
                >
                  [ {waiting === action.id ? 'PRESS A KEY' : keyOf(action) === '' ? 'NONE' : keyLabel(keyOf(action))} ]
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

/** The one settings panel. */
export default function AnimateSettings() {
  const settings = useStudio((state) => state.settings);
  const project = useStudio((state) => state.project);
  const engine = getEngine();

  return (
    <AnimatePanelFrame title="SETTINGS">
      <Group title="PROJECT">
        <p>
          SHEET {project.width} x {project.height}. A NEW SIZE IS A NEW PROJECT.
        </p>
        <label className="flex items-center gap-2">
          PAPER
          <input
            type="color"
            aria-label="Paper colour"
            value={project.background}
            onChange={(event) => engine.tweak((p) => ({ ...p, background: event.target.value }))}
            className="h-8 w-12 cursor-pointer border-line border-ink bg-paper p-0"
          />
        </label>
        <Check label="SAFE-AREA GUIDE" on={project.safeArea} onChange={(safeArea) => engine.tweak((p) => ({ ...p, safeArea }))} />
      </Group>
      <Group title="PEN">
        <CurveEditor />
        <Check label="LEANING THE PEN WIDENS THE LINE" on={settings.tilt} onChange={(tilt) => updateSettings({ tilt })} />
        <Check label="LOW-LATENCY DRAWING (TURN OFF IF LINES FLICKER)" on={settings.lowLatency} onChange={(lowLatency) => updateSettings({ lowLatency })} />
      </Group>
      <Group title="DRAWINGS">
        <AnimateSlider label="NEW DRAWINGS HOLD FOR" min={1} max={4} step={1} value={settings.defaultHold} unit=" FRAMES" onChange={(defaultHold) => updateSettings({ defaultHold })} />
        <Check label="LITTLE PICTURES ON THE TIMELINE" on={settings.showThumbnails} onChange={(showThumbnails) => updateSettings({ showThumbnails })} />
      </Group>
      <Group title="INTERFACE">
        <div role="group" aria-label="Interface size" className="flex flex-wrap items-center gap-1">
          <span>SIZE</span>
          {UI_SCALES.map((scale) => (
            <button key={scale} type="button" className={settings.uiScale === scale ? PLATE_PRESSED : PLATE_MEDIUM} aria-pressed={settings.uiScale === scale} onClick={() => updateSettings({ uiScale: scale })}>
              [ {Math.round(scale * 100)}% ]
            </button>
          ))}
        </div>
        <AnimateSlider label="BRUSH RING THICKNESS" min={1} max={4} step={0.5} value={settings.cursorScale} onChange={(cursorScale) => updateSettings({ cursorScale })} />
        <Check label="LEFT-HANDED: TOOLS ON THE RIGHT" on={settings.leftHanded} onChange={(leftHanded) => updateSettings({ leftHanded })} />
        <p>THEMES FOLLOW THE SITE&apos;S PREFERENCES.</p>
      </Group>
      <Group title="SAVING">
        <AnimateSlider
          label="SAVE EVERY"
          min={5}
          max={120}
          step={5}
          value={settings.autosaveSeconds}
          unit=" SECONDS"
          onChange={(autosaveSeconds) => {
            updateSettings({ autosaveSeconds });
            engine.restartAutosave();
          }}
        />
        <AnimateSlider label="OLDER VERSIONS TO KEEP" min={0} max={10} step={1} value={settings.keepVersions} onChange={(keepVersions) => updateSettings({ keepVersions })} />
      </Group>
      <Group title="KEYS">
        <ShortcutList />
      </Group>
    </AnimatePanelFrame>
  );
}
