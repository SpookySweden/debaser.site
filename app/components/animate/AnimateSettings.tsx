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
  const box = useRef<HTMLCanvasElement>(null);
  const [x1, y1, x2, y2] = curve;
  const px = (v: number) => v * CURVE_SIZE;
  const py = (v: number) => CURVE_SIZE - v * CURVE_SIZE;

  // A graph on a canvas, in the theme's own inks.
  useEffect(() => {
    const canvas = box.current;
    const ctx = canvas?.getContext('2d');
    if (canvas == null || ctx == null) return;
    const css = getComputedStyle(canvas);
    const ink = css.getPropertyValue('--color-ink');
    const pink = css.getPropertyValue('--color-bubble');
    const handle = css.getPropertyValue('--color-sun');
    ctx.clearRect(0, 0, CURVE_SIZE, CURVE_SIZE);
    ctx.lineWidth = 1;
    ctx.strokeStyle = ink;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(0, CURVE_SIZE);
    ctx.lineTo(CURVE_SIZE, 0);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(0, CURVE_SIZE);
    ctx.lineTo(px(x1), py(y1));
    ctx.moveTo(CURVE_SIZE, 0);
    ctx.lineTo(px(x2), py(y2));
    ctx.stroke();
    ctx.lineWidth = 3;
    ctx.strokeStyle = pink;
    ctx.beginPath();
    ctx.moveTo(0, CURVE_SIZE);
    ctx.bezierCurveTo(px(x1), py(y1), px(x2), py(y2), CURVE_SIZE, 0);
    ctx.stroke();
    ctx.lineWidth = 2;
    ctx.fillStyle = handle;
    ctx.strokeStyle = ink;
    for (const [hx, hy] of [[px(x1), py(y1)], [px(x2), py(y2)]]) {
      ctx.beginPath();
      ctx.arc(hx, hy, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  });

  const drag = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const target = event.currentTarget;
    const place = (clientX: number, clientY: number) => {
      const rect = target.getBoundingClientRect();
      return [Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)), Math.max(0, Math.min(1, 1 - (clientY - rect.top) / rect.height))];
    };
    const [startX, startY] = place(event.clientX, event.clientY);
    // Whichever handle is nearer the press.
    const which = Math.hypot(startX - x1, startY - y1) <= Math.hypot(startX - x2, startY - y2) ? 0 : 1;
    target.setPointerCapture(event.pointerId);
    const onMove = (move: PointerEvent) => {
      const [hx, hy] = place(move.clientX, move.clientY);
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
      <canvas ref={box} width={CURVE_SIZE} height={CURVE_SIZE} role="img" aria-label="Pressure curve" className="cursor-grab touch-none border-line border-ink bg-paper" onPointerDown={drag} />
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
      <Group title="SMART TAGS">
        <AnimateSlider label="A NEW TAG'S GAP SIZE" min={1} max={40} step={1} value={settings.defaultGap} unit=" PX" onChange={(defaultGap) => updateSettings({ defaultGap })} />
        <Check label="BIG SMART OFF BADGE" on={settings.bigBadge} onChange={(bigBadge) => updateSettings({ bigBadge })} />
        <button type="button" className={PLATE_MEDIUM} onClick={() => useStudio.setState({ panel: 'tags' })}>
          [ EDIT TAGS ]
        </button>
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
