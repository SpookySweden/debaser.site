'use client';

import { useEffect, useState } from 'react';
import { FIELD_TIGHT, PLATE, PLATE_MAIN, PLATE_ON_BLACK, PLATE_ON_BLACK_PRESSED, PLATE_PRESSED } from '../lib/ui/controls';
import { subscribeToGoLiveAsk, takeGoLiveAsk } from '../lib/watch/main-room-play';
import { ownRoomState } from '../lib/watch/own-room-client';
import { getWatchRepository, repositoryFor } from '../lib/watch/repository';
import Link from 'next/link';
import { streamAnchor, streamThreadTitle } from '../lib/watch/rules';
import type { RoomPrivacy, WatchMember, WatchRoom } from '../lib/watch/types';
import { askToSaveCanvas } from '../lib/watch/use-room-canvas';
import { applyLocalChange } from '../lib/watch/use-watch-room';
import { useForum } from './ForumProvider';
import PopoutWindow from './PopoutWindow';

/**
 * Your main room's own keys on the picture's bar (SPEC-rooms-perpetual.md): `[ GO LIVE ]` while it is private and
 * `[ ● LIVE ]` once it is announced, both opening WHO CAN JOIN; `[ LEAVE ]` while it is live with somebody to hand it
 * to (it becomes theirs, and your next play makes you a new room); `[ END ROOM ]`, two presses, for everybody in it.
 * The same room throughout: going live moves nothing and restarts nothing.
 */
export default function MainRoomKeys({ room, hostName, heir, onLeft }: { room: WatchRoom; hostName: string; heir: WatchMember | null; onLeft: () => void }) {
  // GO LIVE pressed on the music bar or the CYTUBE page opens this room on WHO CAN JOIN (main-room-play.ts).
  const [asking, setAsking] = useState(() => takeGoLiveAsk(room.id));
  // ...and while it is already drawn (the window was open, or folded, when GO LIVE or WATCH IN ROOM was pressed).
  const roomId = room.id;
  useEffect(
    () =>
      subscribeToGoLiveAsk(() => {
        if (takeGoLiveAsk(roomId)) setAsking(true);
      }),
    [roomId],
  );
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fault, setFault] = useState<string | null>(null);
  const live = room.isPublic;

  /** The room is no longer your main room: the session here starts a new one with your next play (Luke, Q1 A: empty). */
  const letGo = () => {
    ownRoomState().session?.renew(room.id);
    applyLocalChange(room.id, { kind: 'refresh' });
    onLeft();
  };

  const leave = async () => {
    if (heir === null || heir.userId === null) return;
    setBusy(true);
    const handed = await getWatchRepository()
      .passOn(room.id, heir.userId)
      .catch(() => false);
    setBusy(false);
    if (handed) letGo();
    else setFault('THE ROOM COULD NOT BE HANDED ON. TRY AGAIN.');
  };

  const end = async () => {
    setBusy(true);
    try {
      // A changed canvas nobody saved asks "save this canvas?" first (SPEC-stream-art.md).
      await askToSaveCanvas(room.id, { ending: true });
      // A visitor's own room is ended where it lives, in this browser.
      await repositoryFor(room.id).endRoom(room.id);
      letGo();
    } catch (failure) {
      setFault(failure instanceof Error ? failure.message : 'THE ROOM COULD NOT BE ENDED.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        className={`${live ? PLATE_ON_BLACK_PRESSED : PLATE_ON_BLACK} shrink-0`}
        data-main-room-live={live ? 'live' : 'private'}
        aria-label={live ? 'Live: change who can join, or go private' : 'Go live: put this room on the lists'}
        title={live ? 'LIVE: CHANGE WHO CAN JOIN, OR GO PRIVATE' : 'GO LIVE: THIS SAME ROOM GOES ON THE LISTS'}
        onClick={() => setAsking(true)}
      >
        {live ? '[ ● LIVE ]' : '[ GO LIVE ]'}
      </button>
      {live && heir !== null ? (
        <button
          type="button"
          disabled={busy}
          className={`${PLATE_ON_BLACK} shrink-0`}
          data-main-room-leave
          aria-label={`Leave: ${heir.name} will host`}
          title={`LEAVE: ${heir.name.toUpperCase()} WILL HOST`}
          onClick={() => void leave()}
        >
          [ LEAVE ]
        </button>
      ) : null}
      <button
        type="button"
        disabled={busy}
        className={`${confirmEnd ? PLATE_ON_BLACK_PRESSED : PLATE_ON_BLACK} shrink-0`}
        data-main-room-end={confirmEnd ? 'confirm' : 'first'}
        onClick={() => {
          if (!confirmEnd) {
            setConfirmEnd(true);
            return;
          }
          void end();
        }}
        onBlur={() => setConfirmEnd(false)}
      >
        {confirmEnd ? '[ END FOR EVERYBODY ]' : '[ END ROOM ]'}
      </button>
      {fault !== null ? (
        <span className="shrink-0 bg-bubble-pale px-1 text-label font-bold text-ink-bar" role="alert">
          {fault}
        </span>
      ) : null}
      {asking ? (
        ownRoomState().visitor && ownRoomState().roomId === room.id ? (
          <LogInToGoLive onClose={() => setAsking(false)} />
        ) : (
          <WhoCanJoin room={room} hostName={hostName} onClose={() => setAsking(false)} />
        )
      ) : null}
    </>
  );
}

/** A signed-out visitor's own room lives in this browser: it can't be put on the site's lists without an account. */
function LogInToGoLive({ onClose }: { onClose: () => void }) {
  return (
    <PopoutWindow title="GO LIVE" onClose={onClose} maxWidth="max-w-md">
      <div className="flex flex-col gap-2 p-2 text-label font-bold text-ink" data-main-room-log-in>
        <p>YOUR ROOM IS KEPT IN THIS BROWSER. TO PUT IT ON THE LISTS, SHARE ITS LINK AND CHAT, LOG IN FIRST.</p>
        <p className="flex flex-wrap gap-2">
          <Link href="/account" className={PLATE_MAIN}>
            [ LOG IN ]
          </Link>
          <button type="button" className={PLATE} onClick={onClose}>
            [ CANCEL ]
          </button>
        </p>
      </div>
    </PopoutWindow>
  );
}

const CHOICES: { value: RoomPrivacy; label: string; tip: string }[] = [
  { value: 'private', label: 'PRIVATE', tip: 'LISTED AS A PRIVATE STREAM. ONLY YOUR LINK LETS PEOPLE IN.' },
  { value: 'password', label: 'PASSWORD', tip: 'ANYBODY WITH THE PASSWORD CAN COME IN.' },
  { value: 'open', label: 'OPEN', tip: 'ANYBODY CAN COME IN AND READ THE CHAT.' },
];

/** WHO CAN JOIN for GO LIVE (PRIVATE picked first, as GO LIVE has always started), and GO PRIVATE once live. */
function WhoCanJoin({ room, hostName, onClose }: { room: WatchRoom; hostName: string; onClose: () => void }) {
  const forum = useForum();
  const live = room.isPublic;
  const [privacy, setPrivacy] = useState<RoomPrivacy>(live ? room.privacy : 'private');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [fault, setFault] = useState<string | null>(null);

  const announce = async (on: boolean) => {
    setBusy(true);
    setFault(null);
    try {
      await getWatchRepository().announceRoom(room.id, on, privacy, privacy === 'password' && password.length > 0 ? password : null);
      // A room has one record on the board, filed the first time it goes live. One that could not be filed is still live.
      if (on && room.forumThreadId === null) {
        try {
          const thread = await forum.createThread({ title: streamThreadTitle(hostName, new Date().toISOString()), body: '', anchor: streamAnchor(room.id) });
          await getWatchRepository().attachThread(room.id, thread.id);
        } catch {
          // Said by the room's own line (NOT ON THE BOARD).
        }
      }
      applyLocalChange(room.id, { kind: 'refresh' });
      onClose();
    } catch (failure) {
      setFault(failure instanceof Error ? failure.message : 'THAT COULD NOT BE CHANGED.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <PopoutWindow title={live ? 'YOUR ROOM IS LIVE' : 'GO LIVE'} onClose={onClose} maxWidth="max-w-md">
      <div className="flex flex-col gap-2 p-2 text-label font-bold text-ink" data-main-room-who>
        <p>{live ? 'WHO CAN JOIN. OR GO PRIVATE: OFF EVERY LIST, EVERYBODY IN STAYS.' : 'THIS SAME ROOM GOES ON THE LISTS. NOTHING RESTARTS.'}</p>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Who can join">
          {CHOICES.map((choice) => (
            <button
              key={choice.value}
              type="button"
              role="radio"
              aria-checked={privacy === choice.value}
              title={choice.tip}
              className={privacy === choice.value ? PLATE_PRESSED : PLATE}
              data-main-room-privacy={choice.value}
              onClick={() => setPrivacy(choice.value)}
            >
              [ {choice.label} ]
            </button>
          ))}
        </div>
        <p>{CHOICES.find((choice) => choice.value === privacy)?.tip}</p>
        {privacy === 'password' ? (
          <label className="flex items-center gap-2">
            PASSWORD
            <input type="password" value={password} maxLength={72} onChange={(event) => setPassword(event.target.value)} className={FIELD_TIGHT} />
          </label>
        ) : null}
        {fault !== null ? (
          <p className="w-fit bg-bubble-pale px-1 text-ink-bar" role="alert">
            {fault}
          </p>
        ) : null}
        <p className="flex flex-wrap gap-2">
          <button type="button" disabled={busy} className={PLATE_MAIN} data-main-room-start onClick={() => void announce(true)}>
            {live ? '[ SAVE ]' : '[ START ]'}
          </button>
          {live ? (
            <button type="button" disabled={busy} className={PLATE} data-main-room-private onClick={() => void announce(false)}>
              [ GO PRIVATE ]
            </button>
          ) : null}
          <button type="button" disabled={busy} className={PLATE} onClick={onClose}>
            [ CANCEL ]
          </button>
        </p>
      </div>
    </PopoutWindow>
  );
}
