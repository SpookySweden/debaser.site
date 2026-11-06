'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { allActions, keyLabel, keyOf } from '../../lib/animate/actions';
import { getEngine } from '../../lib/animate/engine';
import type { ProjectListing } from '../../lib/animate/storage';
import { useStudio } from '../../lib/animate/store';
import { PLATE_MEDIUM, TITLE_BAR } from '../../lib/ui/controls';

/** The panel that floats over the studio. Esc-free: its key or `[ CLOSE ]` shuts it; the studio's keys still work behind it. */
export function AnimatePanelFrame({ title, children }: { title: string; children: ReactNode }) {
  const uiScale = useStudio((state) => state.settings.uiScale);
  return (
    <div role="dialog" aria-label={title} className="absolute right-2 top-12 z-40 flex max-h-[80%] w-[28rem] max-w-[92%] flex-col frame bg-paper p-3 text-key text-ink" style={{ zoom: uiScale }}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className={TITLE_BAR}>{title}</h2>
        <button type="button" className={PLATE_MEDIUM} onClick={() => useStudio.setState({ panel: 'none' })}>
          [ CLOSE ]
        </button>
      </div>
      <div className="min-h-0 overflow-y-auto">{children}</div>
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

function ProjectsPanel() {
  const currentId = useStudio((state) => state.project.id);
  const [list, setList] = useState<ProjectListing[] | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void getEngine()
      .autosave()
      .then(() => getEngine().listProjects())
      .then((rows) => {
        if (live) setList(rows);
      });
    return () => {
      live = false;
    };
  }, [currentId]);

  const reload = () => void getEngine().listProjects().then(setList);

  return (
    <AnimatePanelFrame title="PROJECTS">
      <div className="mb-2 flex flex-wrap gap-2">
        <button
          type="button"
          className={PLATE_MEDIUM}
          onClick={() => {
            void getEngine().newProject().then(reload);
          }}
        >
          [ NEW ]
        </button>
      </div>
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
    </AnimatePanelFrame>
  );
}

/** Whichever floating panel is open. */
export default function AnimatePanels() {
  const panel = useStudio((state) => state.panel);
  if (panel === 'help') return <HelpPanel />;
  if (panel === 'projects') return <ProjectsPanel />;
  return null;
}
