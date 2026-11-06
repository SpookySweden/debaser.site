'use client';

import { useEffect } from 'react';
import { attachKeys } from '../../lib/animate/actions';
import { getEngine } from '../../lib/animate/engine';
import { loadStoredSettings, useStudio } from '../../lib/animate/store';
import '../../lib/animate/layers';
import { installSelection } from '../../lib/animate/selection';
import { installPictures } from '../../lib/animate/picture';
import { stopPlaying } from '../../lib/animate/playback';
import { installSmarts } from '../../lib/animate/smart';
import { installSound } from '../../lib/animate/sound';
import { installTrace } from '../../lib/animate/trace';
import '../../lib/animate/timeline';
import { FilePickers, LayersKey, MenuKey, StatusWords, ToolsKey, WhenItApplies } from './AnimateBars';
import AnimateFramesMenu from './AnimateFramesMenu';
import AnimateLayers from './AnimateLayers';
import AnimateNotice from './AnimateNotice';
import AnimatePanels from './AnimatePanels';
import AnimatePopup from './AnimatePopup';
import AnimateStage from './AnimateStage';
import AnimateTimeline from './AnimateTimeline';

/** The studio: the sheet and the timeline, a few small keys in the corners, and what opens from them. Everything is local to this browser. */
export default function AnimateStudio() {
  const full = useStudio((state) => state.settings.full);
  const uiScale = useStudio((state) => state.settings.uiScale);
  const showLayers = useStudio((state) => state.settings.showLayers);
  const hintSeen = useStudio((state) => state.settings.hintSeen);

  useEffect(() => {
    loadStoredSettings();
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
      <div className="relative flex min-h-0 flex-1">
        <div className="relative flex min-h-0 min-w-0 flex-1">
          <AnimateStage />
          {/* Full screen is the sheet and the timeline. Otherwise, the few keys float in the corners, over the grey round the sheet. */}
          {!full && (
            <>
              <div className="absolute left-1 top-1 z-20 flex max-w-[60%] flex-wrap items-center gap-1" style={{ zoom: uiScale }}>
                <span className="bg-paper">
                  <MenuKey />
                </span>
                <span className="bg-paper">
                  <ToolsKey />
                </span>
                <span className="bg-paper px-1">
                  <StatusWords />
                </span>
              </div>
              <div className="absolute right-1 top-1 z-20 bg-paper" style={{ zoom: uiScale }}>
                <LayersKey />
              </div>
            </>
          )}
          <WhenItApplies />
          {!hintSeen && !full && (
            <p role="note" data-animate-hint className="pointer-events-none absolute bottom-12 left-1/2 z-20 max-w-full -translate-x-1/2 frame bg-paper px-3 py-2 text-center text-heading text-ink" style={{ zoom: uiScale }}>
              DRAW HERE. RIGHT BUTTON OR X FOR TOOLS.
            </p>
          )}
          <AnimatePopup />
          <AnimateFramesMenu />
        </div>
        {showLayers && (
          // On a narrow window it sits over the sheet; on a wide one the sheet gives it room.
          <div className="flex min-h-0 shrink-0 flex-col max-md:absolute max-md:inset-y-0 max-md:right-0 max-md:z-30 max-md:max-w-full" style={{ zoom: uiScale }} data-animate-layers-fold>
            <AnimateLayers />
          </div>
        )}
      </div>
      <AnimateTimeline />
      <FilePickers />
      <AnimateNotice />
      <AnimatePanels />
    </section>
  );
}
