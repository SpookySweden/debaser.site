'use client';

import { useEffect, useRef, useState } from 'react';
import { DEVICE_RTC, beBusy, callBody, gathered, newCall, sendDeviceMessage, takeDeviceMessages, type RemoteSource } from '../lib/screens/devices';
import { PLATE_ON_BLACK } from '../lib/ui/controls';

/**
 * REMOTE showing another of the owner's own devices, with nothing installed on it (SPEC-screens.md). This asks that
 * device; somebody there presses SHARE and chooses a screen in the browser's own prompt (a browser never shares by
 * itself); the picture then travels straight between the two browsers. Watch only: a page cannot move another
 * device's mouse or keys. The room's queue and players carry on underneath.
 */
export default function RoomDeviceScreen({ source }: { source: Extract<RemoteSource, { kind: 'device' }> }) {
  const video = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<'asking' | 'connecting' | 'showing' | 'ended'>('asking');
  const [why, setWhy] = useState('');
  const [tries, setTries] = useState(0);

  useEffect(() => {
    let connection: RTCPeerConnection | null = null;
    let over = false;
    const done = beBusy();
    const call = newCall();
    void sendDeviceMessage(source.id, 'ask', JSON.stringify({ call })).then((trouble) => {
      if (trouble && !over) {
        setWhy(trouble);
        setState('ended');
      }
    });
    const stopHearing = takeDeviceMessages((message) => {
      if (over || message.from !== source.id) return;
      const said = callBody(message.body);
      // Only this picture's own messages: never one left over from an earlier ask.
      if (said === null || said.call !== call) return;
      if (message.kind === 'no') {
        setWhy(said.why || 'IT WAS DECLINED ON THAT DEVICE');
        setState('ended');
      } else if (message.kind === 'stop') {
        setWhy('THE OTHER DEVICE STOPPED SHARING');
        setState('ended');
        connection?.close();
      } else if (message.kind === 'offer') {
        setState('connecting');
        connection?.close();
        const here = new RTCPeerConnection(DEVICE_RTC);
        connection = here;
        here.ontrack = (event) => {
          // Shown the moment each frame is decoded: no waiting queue (as the PC's own picture).
          try {
            (event.receiver as RTCRtpReceiver & { jitterBufferTarget?: number }).jitterBufferTarget = 0;
          } catch {
            /* an older browser */
          }
          if (video.current) {
            video.current.srcObject = new MediaStream([event.track]);
            void video.current.play().catch(() => undefined);
          }
          setState('showing');
        };
        here.onconnectionstatechange = () => {
          if (here.connectionState === 'failed') {
            setWhy('THE TWO DEVICES COULD NOT REACH EACH OTHER (THEY HAVE TO BE ON THE SAME HOME NETWORK FOR NOW)');
            setState('ended');
          }
        };
        void (async () => {
          try {
            await here.setRemoteDescription({ type: 'offer', sdp: said.sdp ?? '' });
            await here.setLocalDescription(await here.createAnswer());
            await gathered(here);
            const trouble = await sendDeviceMessage(source.id, 'answer', JSON.stringify({ call, sdp: here.localDescription?.sdp ?? '' }));
            if (trouble) {
              setWhy(trouble);
              setState('ended');
            }
          } catch {
            setWhy('THE PICTURE COULD NOT BE STARTED');
            setState('ended');
          }
        })();
      }
    });
    return () => {
      over = true;
      stopHearing();
      done();
      connection?.close();
      void sendDeviceMessage(source.id, 'stop', JSON.stringify({ call }));
    };
  }, [source.id, tries]);

  return (
    <div className="absolute inset-0 z-10 bg-ink-plate text-label text-ink-bar" data-room-screen data-room-device-screen={state}>
      <video ref={video} muted autoPlay playsInline className="absolute left-0 top-0 h-full w-full max-w-none bg-ink-plate object-contain" />
      <div className="absolute right-1 top-8 z-30 flex flex-col items-end gap-1 max-sm:top-14">
        <div className="flex max-w-full flex-wrap items-center justify-end gap-1 bg-ink-plate px-1 font-mono">
          <span data-room-device-says>
            {state === 'asking'
              ? `ASKING ${source.name}: SOMEBODY THERE PRESSES SHARE`
              : state === 'connecting'
                ? `CONNECTING TO ${source.name}`
                : state === 'showing'
                  ? `${source.name} :: WATCH ONLY`
                  : why || 'ENDED'}
          </span>
          {state === 'ended' ? (
            <button type="button" className={PLATE_ON_BLACK} onClick={() => {
                setState('asking');
                setWhy('');
                setTries((n) => n + 1);
              }} data-room-device-again>
              [ ASK AGAIN ]
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
