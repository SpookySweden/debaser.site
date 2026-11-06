'use client';

import { useEffect } from 'react';
import { attachKeys } from '../../lib/animate/actions';
import { getEngine } from '../../lib/animate/engine';
import { loadStoredSettings, updateSettings, useStudio } from '../../lib/animate/store';
import '../../lib/animate/layers';
import { installSelection } from '../../lib/animate/selection';
import { installPictures } from '../../lib/animate/picture';
import { stopPlaying } from '../../lib/animate/playback';
import { installSmarts } from '../../lib/animate/smart';
import { installSound } from '../../lib/animate/sound';
import { installTrace } from '../../lib/animate/trace';
import '../../lib/animate/timeline';
import AnimateLayers from './AnimateLayers';
import AnimateNotice from './AnimateNotice';
import AnimatePanels from './AnimatePanels';
import AnimateStage from './AnimateStage';
import AnimatePopup from './AnimatePopup';
import { FrameWords, LayersKey, MenuKey, PlayKey, StatusWords, ThinTimeline, TimeSheet, ToolsKey } from './AnimateBars';

/** The studio: the strip across the top, the tools, the sheet, and the panels that come and go. Everything is local to this browser. */
export default function AnimateStudio() {
  const full = useStudio((state) => state.settings.full);
  const uiScale = useStudio((state) => state.settings.uiScale);
  const showLayers = useStudio((state) => state.settings.showLayers);
  const layout = useStudio((state) => state.settings.layout);
  const hintSeen = useStudio((state) => state.settings.hintSeen);

  useEffect(() => {
    loadStoredSettings();
    // Stage 1's trial switch: /animate?layout=a, b or c.
    const asked = new URLSearchParams(window.location.search).get('layout');
    if (asked === 'a' || asked === 'b' || asked === 'c') updateSettings({ layout: asked });
    const engine = getEngine();
    installSelection();
    installSmarts();
    installTrace();
    installSound();
    installPictures();
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
      // The sheet is gone: nothing keeps playing behind another page.
      stopPlaying(engine);
      window.removeEventListener('beforeunload', guard);
      document.removeEventListener('visibilitychange', hide);
      void engine.autosave();
    };
  }, []);

  const stageWithFloats = (
    <div className="relative flex min-h-0 min-w-0 flex-1">
      <AnimateStage />
      {/* A: the keys float in the corners, over the grey round the sheet. */}
      {layout === 'a' && !full && (
        <div className="absolute left-1 top-1 z-20 flex max-w-[45%] flex-wrap items-center gap-1" style={{ zoom: uiScale }}>
          <span className="bg-paper"><MenuKey /></span>
          <span className="bg-paper"><ToolsKey /></span>
          <span className="bg-paper px-1"><StatusWords /></span>
        </div>
      )}
      {layout === 'a' && !full && (
        <div className="absolute right-1 top-1 z-20 bg-paper" style={{ zoom: uiScale }}>
          <LayersKey />
        </div>
      )}
      {!hintSeen && !full && (
        <p role="note" data-animate-hint className="pointer-events-none absolute left-1/2 top-1/3 z-20 -translate-x-1/2 bg-ink px-3 py-2 text-center text-heading text-paper" style={{ zoom: uiScale }}>
          DRAW HERE. RIGHT-CLICK OR X FOR TOOLS.
        </p>
      )}
      <AnimatePopup />
    </div>
  );
  const layers = showLayers && !full && (
    <div className="flex min-h-0 shrink-0 flex-col" style={{ zoom: uiScale }} data-animate-layers-fold>
      <AnimateLayers />
    </div>
  );

  return (
    <section
      aria-label="Animation studio"
      // A control pressed with the pen or mouse gives the keyboard back at once, so the next key is a shortcut, not that control again.
      // Tabbing to a control with the keyboard keeps it, as it should.
      onPointerUpCapture={() => {
        const focused = document.activeElement;
        if (focused instanceof HTMLButtonElement || (focused instanceof HTMLInputElement && focused.type === 'range')) focused.blur();
      }}
      className={full ? 'fixed inset-0 z-overlay flex flex-col bg-paper text-ink select-none' : 'relative flex h-full min-h-[24rem] flex-col text-ink select-none'}
    >
      {layout === 'c' ? (
        <div className="flex min-h-0 flex-1">
          {stageWithFloats}
          {layers}
          <TimeSheet />
        </div>
      ) : (
        <>
          <div className="flex min-h-0 flex-1">
            {stageWithFloats}
            {layers}
          </div>
          {layout === 'b' ? (
            <div className="shrink-0">
              {!full && (
                <div className="flex flex-wrap items-center gap-x-2 border-t-line border-ink bg-sun-pale px-1 py-0.5" style={{ zoom: uiScale }} data-animate-strip>
                  <StatusWords />
                  <span className="ml-auto flex items-center gap-1">
                    <ToolsKey />
                    <LayersKey />
                    <MenuKey />
                  </span>
                </div>
              )}
              <ThinTimeline maxRows={2} leading={<><PlayKey /><FrameWords /></>} />
            </div>
          ) : (
            <ThinTimeline maxRows={1} leading={<><PlayKey /><FrameWords /></>} />
          )}
        </>
      )}
      <AnimateNotice />
      <AnimatePanels />
    </section>
  );
}
