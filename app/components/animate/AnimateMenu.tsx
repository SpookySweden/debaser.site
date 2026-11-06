'use client';

import { allActions, keyLabel, keyOf, type Action } from '../../lib/animate/actions';
import { getEngine } from '../../lib/animate/engine';
import { updateSettings, useStudio } from '../../lib/animate/store';
import { AnimatePanelFrame } from './AnimatePanels';

const SECOND_KEYS = new Set(['edit.redo2', 'time.next2', 'time.prev2', 'help.close', 'help.keys']);

/**
 * The one way in to everything: every action the studio has, under its heading, with its key. Written from the action list, so nothing can
 * be on the keyboard and missing here, or the other way round.
 */
export default function AnimateMenu() {
  const name = useStudio((state) => state.project.name);
  const saveState = useStudio((state) => state.saveState);
  const engine = getEngine();
  const groups = new Map<string, Action[]>();
  for (const action of allActions()) {
    if (!SECOND_KEYS.has(action.id)) groups.set(action.group, [...(groups.get(action.group) ?? []), action]);
  }
  return (
    <AnimatePanelFrame title="MENU" wide>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <input
          aria-label="Project name"
          value={name}
          maxLength={60}
          onChange={(event) => engine.tweak((project) => ({ ...project, name: event.target.value }))}
          className="frame w-56 bg-paper px-1 py-0.5 font-mono text-title text-ink outline-none focus:outline-2 focus:outline-dotted focus:outline-bubble"
        />
        <span role="status">{saveState === 'failed' ? 'NOT SAVING' : saveState === 'saved' ? 'SAVED HERE' : 'SAVING SOON'}</span>
      </div>
      <div className="columns-2 gap-4 max-md:columns-1">
        {[...groups.entries()].map(([group, actions]) => (
          <section key={group} className="mb-3 break-inside-avoid">
            <h3 className="text-accent-ink">{group}</h3>
            <ul>
              {actions.map((action) => (
                <li key={action.id}>
                  <button
                    type="button"
                    className="key flex w-full cursor-pointer items-baseline justify-between gap-2 px-1 py-0.5 text-left text-key"
                    data-animate-menu-item={action.id}
                    onClick={() => {
                      updateSettings({ hintSeen: true });
                      useStudio.setState({ panel: 'none' });
                      action.run();
                    }}
                  >
                    <span className="min-w-0">{action.label}</span>
                    <span className="shrink-0 whitespace-nowrap">{keyOf(action) === '' ? '' : keyLabel(keyOf(action))}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </AnimatePanelFrame>
  );
}
