'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { allActions, keyLabel, keyOf } from '../../lib/animate/actions';
import { getEngine } from '../../lib/animate/engine';
import { DEFAULT_FPS, DEFAULT_HEIGHT, DEFAULT_WIDTH } from '../../lib/animate/project';
import type { ProjectListing } from '../../lib/animate/storage';
import { useStudio } from '../../lib/animate/store';
import { PLATE_MEDIUM, TITLE_BAR } from '../../lib/ui/controls';
import AnimateExportPanel from './AnimateExportPanel';
import AnimateMenu from './AnimateMenu';
import AnimateOnionPanel from './AnimateOnionPanel';
import AnimateSettings from './AnimateSettings';
import AnimateSoundPanel from './AnimateSoundPanel';
import AnimateTagPanel from './AnimateTagPanel';

/** The panel that floats over the studio. Esc-free: its key or `[ CLOSE ]` shuts it; the studio's keys still work behind it. */
export function AnimatePanelFrame({ title, children, wide = false }: { title: string; children: ReactNode; wide?: boolean }) {
  const uiScale = useStudio((state) => state.settings.uiScale);
  return (
    // Held inside the studio's own box, so at any interface size it's all reachable and nothing hides behind the site's strips.
    <div className="pointer-events-none absolute inset-1 z-40 flex justify-end">
      <div role="dialog" aria-label={title} className={`pointer-events-auto flex h-fit max-h-full max-w-full flex-col frame bg-paper p-3 text-key text-ink ${wide ? 'w-[44rem]' : 'w-[28rem]'}`} style={{ zoom: uiScale }}>
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 className={TITLE_BAR}>{title}</h2>
          <button type="button" className={PLATE_MEDIUM} onClick={() => useStudio.setState({ panel: 'none' })}>
            [ CLOSE ]
          </button>
        </div>
        <div className="min-h-0 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

function HelpPanel() {
  const groups = new Map<string, { label: string; key: string }[]>();
  for (const action of allActions()) {
    const list = groups.get(action.group) ?? [];
    list.push({ label: action.label, key: keyLabel(keyOf(action)) });
    groups.set(action.group, list);
  }
  return (
    <AnimatePanelFrame title="KEYS">
      <p className="mb-2">HOLD SPACE TO PAN. WHEEL TO ZOOM. SHIFT + WHEEL TO TURN. ALT + PEN PICKS A COLOUR. RIGHT BUTTON DRAGS THE VIEW AND DROPS A STROKE.</p>
      {[...groups.entries()].map(([group, list]) => (
        <section key={group} className="mb-2">
          <h3 className="text-accent-ink">{group}</h3>
          <dl className="grid grid-cols-[1fr_auto] gap-x-3">
            {list.map((item) => (
              <div key={item.label} className="contents">
                <dt>{item.label}</dt>
                <dd>{item.key}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </AnimatePanelFrame>
  );
}

function SizeField({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (value: number) => void }) {
  return (
    <label className="flex flex-col gap-0.5">
      {label}
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        aria-label={label}
        onChange={(event) => onChange(Math.max(min, Math.min(max, Math.round(Number(event.target.value)) || min)))}
        className="frame w-20 bg-paper px-1 py-0.5 font-mono text-key text-ink outline-none focus:outline-2 focus:outline-dotted focus:outline-bubble"
      />
    </label>
  );
}

function ProjectsPanel() {
  const currentId = useStudio((state) => state.project.id);
  const [list, setList] = useState<ProjectListing[] | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [versions, setVersions] = useState<{ name: string; time: number }[]>([]);
  const [size, setSize] = useState({ width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT, fps: DEFAULT_FPS });

  useEffect(() => {
    let live = true;
    void getEngine()
      .autosave()
      .then(() => getEngine().listProjects())
      .then((rows) => {
        if (live) setList(rows);
      });
    void getEngine()
      .versions()
      .then((rows) => {
        if (live) setVersions(rows);
      });
    return () => {
      live = false;
    };
  }, [currentId]);

  const reload = () => void getEngine().listProjects().then(setList);

  return (
    <AnimatePanelFrame title="PROJECTS">
      <form
        className="mb-2 flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void getEngine().newProject(undefined, size.width, size.height, size.fps).then(reload);
        }}
      >
        <SizeField label="WIDE" value={size.width} min={16} max={7680} onChange={(width) => setSize({ ...size, width })} />
        <SizeField label="TALL" value={size.height} min={16} max={7680} onChange={(height) => setSize({ ...size, height })} />
        <SizeField label="FPS" value={size.fps} min={1} max={60} onChange={(fps) => setSize({ ...size, fps })} />
        <button type="submit" className={PLATE_MEDIUM}>
          [ NEW ]
        </button>
      </form>
      {list === null && <p>LOOKING...</p>}
      {list !== null && list.length === 0 && <p>NOTHING YET.</p>}
      <ul className="flex flex-col gap-1">
        {list?.map((row) => (
          <li key={row.id} className="flex flex-wrap items-center gap-2">
            <span className={`min-w-0 flex-1 truncate ${row.id === currentId ? 'text-accent-ink' : ''}`}>{row.name}</span>
            {row.id !== currentId && (
              <button type="button" className={PLATE_MEDIUM} onClick={() => void getEngine().switchProject(row.id)}>
                [ OPEN ]
              </button>
            )}
            {confirming === row.id ? (
              <button
                type="button"
                className={PLATE_MEDIUM}
                onClick={() => {
                  setConfirming(null);
                  void getEngine().deleteProject(row.id).then(reload);
                }}
              >
                [ REALLY DELETE ]
              </button>
            ) : (
              <button type="button" className={PLATE_MEDIUM} onClick={() => setConfirming(row.id)}>
                [ DELETE ]
              </button>
            )}
          </li>
        ))}
      </ul>
      {versions.length > 0 && (
        <>
          <h3 className="mt-3 text-accent-ink">OLDER VERSIONS OF THIS ONE</h3>
          <ul className="flex flex-col gap-1">
            {versions.map((version) => (
              <li key={version.name} className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate">{new Date(version.time).toLocaleString()}</span>
                <button type="button" className={PLATE_MEDIUM} onClick={() => void getEngine().openVersion(version.name)}>
                  [ OPEN A COPY ]
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </AnimatePanelFrame>
  );
}

/** Whichever floating panel is open. */
export default function AnimatePanels() {
  const panel = useStudio((state) => state.panel);
  if (panel === 'menu' || panel === 'help') return <AnimateMenu />;
  if (panel === 'projects') return <ProjectsPanel />;
  if (panel === 'onion') return <AnimateOnionPanel />;
  if (panel === 'export') return <AnimateExportPanel />;
  if (panel === 'settings') return <AnimateSettings />;
  if (panel === 'tags') return <AnimateTagPanel />;
  if (panel === 'sound') return <AnimateSoundPanel />;
  return null;
}
