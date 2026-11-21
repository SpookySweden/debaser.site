'use client';

import { useEffect, useRef, useState } from 'react';
import { DEVICE_RTC, beBusy, callBody, gathered, sendDeviceMessage, startDeviceBeacon, takeDeviceMessages, useOtherDevices } from '../lib/screens/devices';
import { PLATE_ON_BLACK } from '../lib/ui/controls';

/**
 * The other end of REMOTE from another device (SPEC-screens.md): on every page, for the owner only, this tab says
 * "here I am" and listens for one of the owner's other devices asking to see this screen. Asked, it shows a pop-up;
 * a browser never shares a screen by itself, so SHARE must be pressed here and a screen chosen in the browser's own
 * prompt. While sharing, a strip says so, with STOP. Nothing is controlled from the other side.
 */

type Ask = { from: string; name: string; call: string };
type Sharing = { to: string; name: string };

export default function DeviceShareGate() {
  const devices = useOtherDevices();
  const [ask, setAsk] = useState<Ask | null>(null);
  const [sharing, setSharing] = useState<Sharing | null>(null);
  const [trouble, setTrouble] = useState('');
  const live = useRef<{ connection: RTCPeerConnection; stream: MediaStream; to: string; call: string; done: () => void } | null>(null);
  const names = useRef(new Map<string, string>());

  useEffect(() => startDeviceBeacon(), []);
  useEffect(() => {
    for (const d of devices.others) names.current.set(d.id, d.name);
  }, [devices.others]);

  const stop = (tell: boolean) => {
    const was = live.current;
    live.current = null;
    if (was) {
      for (const track of was.stream.getTracks()) track.stop();
      was.connection.close();
      was.done();
      if (tell) void sendDeviceMessage(was.to, 'stop', JSON.stringify({ call: was.call }));
    }
    setSharing(null);
  };

  useEffect(
    () =>
      takeDeviceMessages((message) => {
        const said = callBody(message.body);
        if (said === null) return;
        if (message.kind === 'ask') {
          setTrouble('');
          setAsk({ from: message.from, name: names.current.get(message.from) ?? 'YOUR OTHER DEVICE', call: said.call });
        } else if (message.kind === 'answer' && live.current && live.current.to === message.from && live.current.call === said.call) {
          void live.current.connection.setRemoteDescription({ type: 'answer', sdp: said.sdp ?? '' }).catch(() => setTrouble('The other device\'s answer could not be used.'));
        } else if (message.kind === 'stop') {
          // Only the picture it names: a stop that arrives after the next ask leaves that ask alone.
          if (live.current && live.current.to === message.from && live.current.call === said.call) stop(false);
          setAsk((was) => (was && was.from === message.from && was.call === said.call ? null : was));
        }
      }),
    [],
  );
  useEffect(() => () => stop(true), []);

  const share = async (asked: Ask) => {
    setAsk(null);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 60 } }, audio: false });
    } catch {
      void sendDeviceMessage(asked.from, 'no', JSON.stringify({ call: asked.call, why: 'NOBODY CHOSE A SCREEN TO SHARE ON IT' }));
      return;
    }
    stop(true);
    const connection = new RTCPeerConnection(DEVICE_RTC);
    for (const track of stream.getVideoTracks()) {
      try {
        track.contentHint = 'motion';
      } catch {
        /* an older browser */
      }
      connection.addTrack(track, stream);
      // The browser's own "stop sharing" ends it here too.
      track.addEventListener('ended', () => stop(true));
    }
    const done = beBusy();
    live.current = { connection, stream, to: asked.from, call: asked.call, done };
    setSharing({ to: asked.from, name: asked.name });
    try {
      await connection.setLocalDescription(await connection.createOffer());
      await gathered(connection);
      const why = await sendDeviceMessage(asked.from, 'offer', JSON.stringify({ call: asked.call, sdp: connection.localDescription?.sdp ?? '' }));
      if (why) {
        setTrouble(why);
        stop(false);
      }
    } catch {
      setTrouble('The picture could not be started.');
      stop(true);
    }
  };

  if (!devices.on || (!ask && !sharing && !trouble)) return null;
  return (
    <div className="fixed left-1/2 top-16 z-50 flex max-w-[calc(100%-1rem)] -translate-x-1/2 flex-col gap-1 border border-ink-bar bg-ink-plate px-2 py-1 font-mono text-label text-ink-bar" role="dialog" aria-label="Share this screen" data-device-share>
      {ask ? (
        <>
          <p data-device-share-asks>{`${ask.name} WANTS TO SEE THIS SCREEN.`}</p>
          <p>Press SHARE, then choose a screen in your browser&apos;s own window. The other device can only watch: it cannot control this one.</p>
          <div className="flex flex-wrap gap-1">
            <button type="button" className={PLATE_ON_BLACK} onClick={() => void share(ask)} data-device-share-yes>
              [ SHARE THIS SCREEN ]
            </button>
            <button
              type="button"
              className={PLATE_ON_BLACK}
              onClick={() => {
                void sendDeviceMessage(ask.from, 'no', JSON.stringify({ call: ask.call, why: 'IT WAS DECLINED ON THAT DEVICE' }));
                setAsk(null);
              }}
              data-device-share-no
            >
              [ NO ]
            </button>
          </div>
        </>
      ) : null}
      {sharing ? (
        <div className="flex flex-wrap items-center gap-1" data-device-sharing>
          <span>{`SHARING THIS SCREEN WITH ${sharing.name}`}</span>
          <button type="button" className={PLATE_ON_BLACK} onClick={() => stop(true)} data-device-share-stop>
            [ STOP ]
          </button>
        </div>
      ) : null}
      {trouble ? (
        <div className="flex flex-wrap items-center gap-1">
          <p role="status">{trouble}</p>
          <button type="button" className={PLATE_ON_BLACK} onClick={() => setTrouble('')}>
            [ OK ]
          </button>
        </div>
      ) : null}
    </div>
  );
}
