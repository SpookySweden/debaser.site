'use client';

import { useEffect } from 'react';
import { attachKeys } from '../../lib/animate/actions';
import { getEngine } from '../../lib/animate/engine';
import { loadStoredSettings, updateSettings, useStudio } from '../../lib/animate/store';
import { PLATE_MEDIUM } from '../../lib/ui/controls';
import '../../lib/animate/layers';
import { installSelection } from '../../lib/animate/selection';
import '../../lib/animate/timeline';
import AnimateLayers from './AnimateLayers';
import AnimateNotice from './AnimateNotice';
import AnimatePanels from './AnimatePanels';
import AnimateStage from './AnimateStage';
import AnimateTimeline from './AnimateTimeline';
import AnimateTools from './AnimateTools';
import AnimateTopBar from './AnimateTopBar';

/** The studio: the strip across the top, the tools, the sheet, and the panels that come and go. Everything is local to this browser. */
export default function AnimateStudio() {
  const full = useStudio((state) => state.settings.full);
  const uiScale = useStudio((state) => state.settings.uiScale);
  const leftHanded = useStudio((state) => state.settings.leftHanded);
  const showLayers = useStudio((state) => state.settings.showLayers);
  const panelsHidden = useStudio((state) => state.settings.panelsHidden);

  useEffect(() => {
    loadStoredSettings();
    const engine = getEngine();
    installSelection();
    void engine.start();
    const detachKeys = attachKeys();

    // The work saves itself; this is only for the seconds between a stroke and its save.
    const guard = (event: BeforeUnloadEvent) => {
      if (getEngine().needsSaving()) {
        void getEngine().autosave();
        event.preventDefault();
      }
    };
    const hide = () => {
      if (document.visibilityState === 'hidden') void getEngine().autosave();
    };
    window.addEventListener('beforeunload', guard);
    document.addEventListener('visibilitychange', hide);
    return () => {
      detachKeys();
      window.removeEventListener('beforeunload', guard);
      document.removeEventListener('visibilitychange', hide);
      void engine.autosave();
    };
  }, []);

  return (
    <section
      aria-label="Animation studio"
      // A control pressed with the pen or mouse gives the keyboard back at once, so the next key is a shortcut, not that control again.
      // Tabbing to a control with the keyboard keeps it, as it should.
      onPointerUpCapture={() => {
        const focused = document.activeElement;
        if (focused instanceof HTMLButtonElement || (focused instanceof HTMLInputElement && focused.type === 'range')) focused.blur();
      }}
      className={
        full
          ? 'fixed inset-0 z-overlay flex flex-col overflow-y-auto bg-paper text-ink select-none'
          : 'relative flex h-full min-h-[32rem] flex-col overflow-y-auto text-ink select-none max-md:h-auto'
      }
    >
      {!panelsHidden && (
        <div className="shrink-0" style={{ zoom: uiScale }}>
          <AnimateTopBar />
        </div>
      )}
      {/* The sheet always keeps a good share of the screen: at a big interface size the rest scrolls, rather than squeezing the sheet out. */}
      <div className={`flex min-h-[50vh] flex-1 shrink-0 max-md:flex-none max-md:flex-col ${leftHanded ? 'flex-row-reverse' : ''}`}>
        {!panelsHidden && (
          <div className="flex min-h-0 shrink-0 flex-col overflow-y-auto max-md:overflow-visible" style={{ zoom: uiScale }}>
            <AnimateTools />
          </div>
        )}
        <AnimateStage />
        {!panelsHidden && showLayers && (
          <div className="flex min-h-0 shrink-0 flex-col max-md:shrink" style={{ zoom: uiScale }}>
            <AnimateLayers />
          </div>
        )}
      </div>
      <div className="shrink-0" style={{ zoom: uiScale }}>
        {!panelsHidden && <AnimateTimeline />}
        <AnimateNotice />
      </div>
      {panelsHidden && (
        <button
          type="button"
          className={`${PLATE_MEDIUM} absolute right-2 top-2 z-30 bg-paper`}
          style={{ zoom: uiScale }}
          title="`"
          onClick={() => updateSettings({ panelsHidden: false })}
        >
          [ SHOW PANELS ]
        </button>
      )}
      <AnimatePanels />
    </section>
  );
}
