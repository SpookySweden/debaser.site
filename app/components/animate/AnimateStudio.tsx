'use client';

import { useEffect } from 'react';
import { attachKeys } from '../../lib/animate/actions';
import { getEngine } from '../../lib/animate/engine';
import { loadStoredSettings, useStudio } from '../../lib/animate/store';
import AnimateNotice from './AnimateNotice';
import AnimatePanels from './AnimatePanels';
import AnimateStage from './AnimateStage';
import AnimateTools from './AnimateTools';
import AnimateTopBar from './AnimateTopBar';

/** The studio: the strip across the top, the tools, the sheet, and the panels that come and go. Everything is local to this browser. */
export default function AnimateStudio() {
  const full = useStudio((state) => state.settings.full);
  const uiScale = useStudio((state) => state.settings.uiScale);
  const leftHanded = useStudio((state) => state.settings.leftHanded);

  useEffect(() => {
    loadStoredSettings();
    const engine = getEngine();
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
      className={
        full
          ? 'fixed inset-0 z-overlay flex flex-col bg-paper text-ink select-none'
          : 'flex h-full min-h-[32rem] flex-col text-ink select-none'
      }
    >
      <div className="shrink-0" style={{ zoom: uiScale }}>
        <AnimateTopBar />
      </div>
      <div className={`flex min-h-0 flex-1 max-md:flex-col ${leftHanded ? 'flex-row-reverse' : ''}`}>
        <div className="flex min-h-0 shrink-0 flex-col overflow-y-auto max-md:max-h-[40%]" style={{ zoom: uiScale }}>
          <AnimateTools />
        </div>
        <AnimateStage />
      </div>
      <div className="shrink-0" style={{ zoom: uiScale }}>
        <AnimateNotice />
      </div>
      <AnimatePanels />
    </section>
  );
}
