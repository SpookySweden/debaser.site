'use client';

import { useRef } from 'react';
import { stepUiScale } from '../../lib/animate/actions';
import { getEngine } from '../../lib/animate/engine';
import { updateSettings, useStudio, type SaveState } from '../../lib/animate/store';
import { importPicture } from '../../lib/animate/picture';
import { FILE_EXTENSION } from '../../lib/animate/project-file';
import { toggleSmarts } from '../../lib/animate/smart';
import { PLATE_MEDIUM, PLATE_PRESSED } from '../../lib/ui/controls';

const SAVE_WORDS: Record<SaveState, string> = {
  saved: 'SAVED HERE',
  saving: 'SAVING...',
  waiting: 'NOT SAVED YET',
  failed: 'NOT SAVING',
};

/** The strip across the top: the project, undo, and how big everything is. */
export default function AnimateTopBar() {
  const name = useStudio((state) => state.project.name);
  const canUndo = useStudio((state) => state.canUndo);
  const canRedo = useStudio((state) => state.canRedo);
  const saveState = useStudio((state) => state.saveState);
  const fileDirty = useStudio((state) => state.fileDirty);
  const full = useStudio((state) => state.settings.full);
  const uiScale = useStudio((state) => state.settings.uiScale);
  const zoomPercent = useStudio((state) => state.zoomPercent);
  const smartOn = useStudio((state) => state.smartOn);
  const openFile = useRef<HTMLInputElement>(null);
  const importFile = useRef<HTMLInputElement>(null);

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b-line border-ink bg-sun-pale px-2 py-1 text-key">
      <label className="flex items-center gap-1">
        <span className="sr-only">Project name</span>
        <input
          aria-label="Project name"
          value={name}
          maxLength={60}
          onChange={(event) => getEngine().tweak((project) => ({ ...project, name: event.target.value }))}
          className="frame w-40 bg-paper px-1 py-0.5 font-mono text-key text-ink outline-none focus:outline-2 focus:outline-dotted focus:outline-bubble"
        />
      </label>
      <button type="button" className={PLATE_MEDIUM} onClick={() => useStudio.setState({ panel: 'projects' })}>
        [ PROJECTS ]
      </button>
      <button type="button" className={PLATE_MEDIUM} onClick={() => openFile.current?.click()} title="CTRL + O">
        [ OPEN ]
      </button>
      <button type="button" className={PLATE_MEDIUM} onClick={() => void getEngine().saveToFile()} title="CTRL + S">
        [ SAVE FILE{fileDirty ? ' *' : ''} ]
      </button>
      <input
        ref={openFile}
        id="animate-open-file"
        type="file"
        accept={`${FILE_EXTENSION},.zip`}
        className="sr-only"
        tabIndex={-1}
        aria-label="Open a project file"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file !== undefined) void getEngine().openFile(file);
        }}
      />
      <button type="button" className={PLATE_MEDIUM} onClick={() => importFile.current?.click()} title="CTRL + I">
        [ PICTURE ]
      </button>
      <input
        ref={importFile}
        id="animate-import-picture"
        type="file"
        accept="image/*"
        className="sr-only"
        tabIndex={-1}
        aria-label="Import a picture"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file !== undefined) void importPicture(file);
        }}
      />
      <span role="status" className={saveState === 'failed' ? 'w-fit bg-bubble-pale px-1 text-ink-bar' : 'text-ink'} data-animate-save={saveState}>
        {SAVE_WORDS[saveState]}
      </span>

      <button type="button" className={smartOn ? PLATE_PRESSED : PLATE_MEDIUM} aria-pressed={smartOn} onClick={toggleSmarts} title="Q (HOLD FOR ONE STROKE)" data-animate-smart-key>
        [ SMART {smartOn ? 'ON' : 'OFF'} ]
      </button>

      <span className="ml-auto flex flex-wrap items-center gap-x-2 gap-y-1">
        <button type="button" className={PLATE_MEDIUM} disabled={!canUndo} onClick={() => getEngine().undo()} title="CTRL + Z">
          [ UNDO ]
        </button>
        <button type="button" className={PLATE_MEDIUM} disabled={!canRedo} onClick={() => getEngine().redo()} title="CTRL + Y">
          [ REDO ]
        </button>
        <span className="text-ink" aria-label={`Zoom ${zoomPercent} percent`}>
          {zoomPercent}%
        </span>
        <button type="button" className={PLATE_MEDIUM} onClick={() => getEngine().fitView()} title="0">
          [ FIT ]
        </button>
        <button type="button" className={PLATE_MEDIUM} onClick={() => stepUiScale(-1)} aria-label="Interface smaller" title="CTRL + ;">
          [ UI - ]
        </button>
        <span className="text-ink" aria-label={`Interface ${Math.round(uiScale * 100)} percent`}>
          {Math.round(uiScale * 100)}%
        </span>
        <button type="button" className={PLATE_MEDIUM} onClick={() => stepUiScale(1)} aria-label="Interface bigger" title="CTRL + '">
          [ UI + ]
        </button>
        <button type="button" className={full ? PLATE_PRESSED : PLATE_MEDIUM} aria-pressed={full} onClick={() => updateSettings({ full: !full })} title="\">
          [ FULL ]
        </button>
        <button type="button" className={PLATE_MEDIUM} onClick={() => updateSettings({ panelsHidden: true })} title="`">
          [ HIDE PANELS ]
        </button>
        <button type="button" className={PLATE_MEDIUM} onClick={() => useStudio.setState({ panel: 'settings' })} title="CTRL + ,">
          [ SETTINGS ]
        </button>
        <button type="button" className={PLATE_MEDIUM} onClick={() => useStudio.setState({ panel: 'help' })} title="?">
          [ ? ]
        </button>
      </span>
    </div>
  );
}
