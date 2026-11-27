'use client';

import { useState } from 'react';
import { FIELD_TIGHT, PLATE, PLATE_MAIN, PLATE_ON_BLACK, PLATE_ON_BLACK_PRESSED, PLATE_PRESSED } from '../lib/ui/controls';
import { ownRoomState } from '../lib/watch/own-room-client';
import { getWatchRepository, repositoryFor } from '../lib/watch/repository';
import Link from 'next/link';
import { streamAnchor, streamThreadTitle } from '../lib/watch/rules';
import type { RoomPrivacy, WatchMember, WatchRoom } from '../lib/watch/types';
import { askToSaveCanvas } from '../lib/watch/use-room-canvas';
import { applyLocalChange } from '../lib/watch/use-watch-room';
import { useForum } from './ForumProvider';
import PopoutWindow from './PopoutWindow';
import { explain, NOTE } from '../lib/ui/explain';

/**
 * Your main room's own keys and settings (SPEC-rooms-perpetual.md). Making it public or private and ending it live in the
 * room's cog (Luke, 2026-11-17: "the ability to make your room public or private again etc should be accessable through
 * the settings cog in the top right corner of the room rather than clicking the go live button", "end room should also be
 * inside of the room settings rather than at the bottom right"): `MainRoomLiveSection` (WHO CAN JOIN, START, GO PRIVATE)
 * and `MainRoomEndSection` (END ROOM, two presses), drawn by `RoomSettingsWindow`, or by `VisitorRoomSettings` for a
 * signed-out visitor's own room.
 *
 * On the picture's bar stay `[ GO LIVE ]` / `[ ● LIVE ]`, now only a shortcut that opens the cog on WHO CAN JOIN, and
 * `[ LEAVE ]` while it is live with somebody to hand it to (it becomes theirs, and your next play makes you a new room).
 * The same room throughout: going live moves nothing and restarts nothing.
 */
export default function MainRoomKeys({ room, heir, onLeft, onAskLive }: { room: WatchRoom; heir: WatchMember | null; onLeft: () => void; /** Opens the cog on WHO CAN JOIN. */ onAskLive: () => void }) {
  const [busy, setBusy] = useState(false);
  const [fault, setFault] = useState<string | null>(null);
  const live = room.isPublic;

  const leave = async () => {
    if (heir === null || heir.userId === null) return;
    setBusy(true);
    const handed = await getWatchRepository()
      .passOn(room.id, heir.userId)
      .catch(() => false);
    setBusy(false);
    if (handed) letGo(room, onLeft);
    else setFault('THE ROOM COULD NOT BE HANDED ON. TRY AGAIN.');
  };

  return (
    <>
      <button
        type="button"
        className={`${live ? PLATE_ON_BLACK_PRESSED : PLATE_ON_BLACK} shrink-0`}
        data-main-room-live={live ? 'live' : 'private'}
        aria-haspopup="dialog"
        aria-label={live ? 'Live: change who can join, or go private, in the room settings' : 'Go live: opens the room settings on who can join'}
        title={live ? 'LIVE: CHANGE WHO CAN JOIN, OR GO PRIVATE (ROOM SETTINGS)' : 'GO LIVE: WHO CAN JOIN, IN THE ROOM SETTINGS'}
        {...explain(live ? 'Opens the room settings on who can join: change it, or go private.' : 'Opens the room settings on who can join, to go live.', live ? 'Your room is live: people can find it and come in.' : 'Your room is private until you choose who can join and press GO LIVE there.')}
        onClick={onAskLive}
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
          {...explain(`Leaves your live room; ${heir.name} becomes the host and it carries on.`, 'The room keeps going without you.', NOTE.others)}
          onClick={() => void leave()}
        >
          [ LEAVE ]
        </button>
      ) : null}
      {fault !== null ? (
        <span className="shrink-0 bg-bubble-pale px-1 text-label font-bold text-ink-bar" role="alert">
          {fault}
        </span>
      ) : null}
    </>
  );
}

/** The room is no longer your main room: the session here starts a new one with your next play (Luke, Q1 A: empty). */
function letGo(room: WatchRoom, onLeft: () => void) {
  ownRoomState().session?.renew(room.id);
  applyLocalChange(room.id, { kind: 'refresh' });
  onLeft();
}

/** `[ END ROOM ]`, two presses, for everybody in it: in the room's cog. */
export function MainRoomEndSection({ room, onLeft }: { room: WatchRoom; onLeft: () => void }) {
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fault, setFault] = useState<string | null>(null);

  const end = async () => {
    setBusy(true);
    try {
      // A changed canvas nobody saved asks "save this canvas?" first (SPEC-stream-art.md).
      await askToSaveCanvas(room.id, { ending: true });
      // A visitor's own room is ended where it lives, in this browser.
      await repositoryFor(room.id).endRoom(room.id);
      letGo(room, onLeft);
    } catch (failure) {
      setFault(failure instanceof Error ? failure.message : 'THE ROOM COULD NOT BE ENDED.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2" data-room-end-section>
      <span className="font-bold">END THE ROOM:</span>
      <button
        type="button"
        disabled={busy}
        className={confirmEnd ? PLATE_PRESSED : PLATE}
        data-main-room-end={confirmEnd ? 'confirm' : 'first'}
        {...explain(confirmEnd ? 'Ends the room for everybody in it, now.' : 'Ends the room. The first press asks; the second ends it for everybody.', 'Everyone is sent out and the room stops playing.', "CAN'T BE UNDONE.")}
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
      {confirmEnd ? <span className="font-bold">PRESS AGAIN: EVERYBODY IN IT LEAVES.</span> : null}
      {fault !== null ? (
        <span className="w-fit bg-bubble-pale px-1 font-bold text-ink-bar" role="alert">
          {fault}
        </span>
      ) : null}
    </div>
  );
}

/**
 * A signed-out visitor's own room lives in this browser: it can't be put on the site's lists without an account, so its
 * cog says LOG IN for going live, and holds END ROOM.
 */
export function VisitorRoomSettings({ room, onLeft, onClose }: { room: WatchRoom; onLeft: () => void; onClose: () => void }) {
  return (
    <PopoutWindow title="ROOM SETTINGS" onClose={onClose} maxWidth="max-w-md">
      <div className="flex flex-col gap-3 p-2 text-label text-ink" data-room-settings data-visitor-room-settings>
        <div className="flex flex-col gap-2 font-bold" data-room-live-section data-main-room-log-in>
          <p>GO LIVE: YOUR ROOM IS KEPT IN THIS BROWSER. TO PUT IT ON THE LISTS, SHARE ITS LINK AND CHAT, LOG IN FIRST.</p>
          <p>
            <Link href="/account" className={PLATE_MAIN} {...explain('Goes to the ACCOUNT page to log in or make an account.', 'Going live needs an account: your room is kept in this browser until then.')}>
              [ LOG IN ]
            </Link>
          </p>
        </div>
        <MainRoomEndSection room={room} onLeft={onLeft} />
      </div>
    </PopoutWindow>
  );
}

const CHOICES: { value: RoomPrivacy; label: string; tip: string }[] = [
  { value: 'private', label: 'PRIVATE', tip: 'LISTED AS A PRIVATE STREAM. ONLY YOUR LINK LETS PEOPLE IN.' },
  { value: 'password', label: 'PASSWORD', tip: 'ANYBODY WITH THE PASSWORD CAN COME IN.' },
  { value: 'open', label: 'OPEN', tip: 'ANYBODY CAN COME IN AND READ THE CHAT.' },
];

/**
 * WHO CAN JOIN, in the room's cog: GO LIVE (PRIVATE picked first, as GO LIVE has always started) while it is private, and
 * SAVE or GO PRIVATE once live.
 */
export function MainRoomLiveSection({ room, hostName }: { room: WatchRoom; hostName: string }) {
  const forum = useForum();
  const live = room.isPublic;
  // Null until touched, so what the room says shows (going live or private again sets it back).
  const [privacyDraft, setPrivacyDraft] = useState<RoomPrivacy | null>(null);
  const privacy = privacyDraft ?? (live ? room.privacy : 'private');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [fault, setFault] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);

  const announce = async (on: boolean) => {
    setBusy(true);
    setFault(null);
    setSaid(null);
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
      setPrivacyDraft(null);
      setPassword('');
      setSaid(on ? (live ? 'SAVED.' : 'YOUR ROOM IS LIVE.') : 'YOUR ROOM IS PRIVATE AGAIN.');
    } catch (failure) {
      setFault(failure instanceof Error ? failure.message : 'THAT COULD NOT BE CHANGED.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-2" data-room-live-section data-main-room-who>
      <p className="font-bold">
        {live ? 'YOUR ROOM IS LIVE. WHO CAN JOIN, OR GO PRIVATE: OFF EVERY LIST, EVERYBODY IN STAYS.' : "PRIVATE: ONLY SOMEBODY SIGNED IN WHO HAS YOUR ROOM'S LINK. GO LIVE: THIS SAME ROOM GOES ON THE LISTS. NOTHING RESTARTS."}
      </p>
      <div className="flex flex-wrap items-center gap-1" role="radiogroup" aria-label="Who can join">
        <span className="font-bold">WHO CAN JOIN:</span>
        {CHOICES.map((choice) => (
          <button
            key={choice.value}
            type="button"
            role="radio"
            aria-checked={privacy === choice.value}
            title={choice.tip}
            className={privacy === choice.value ? PLATE_PRESSED : PLATE}
            {...explain(`Makes the room ${choice.label}: ${choice.tip.toLowerCase()}`, 'Who can join your room. It takes effect when you press GO LIVE or SAVE.')}
            data-main-room-privacy={choice.value}
            onClick={() => {
              setPrivacyDraft(choice.value);
              setSaid(null);
            }}
          >
            [ {choice.label} ]
          </button>
        ))}
      </div>
      <p>{CHOICES.find((choice) => choice.value === privacy)?.tip}</p>
      {privacy === 'password' ? (
        <label className="flex items-center gap-2 font-bold">
          PASSWORD
          <input type="password" value={password} maxLength={72} onChange={(event) => setPassword(event.target.value)} className={`${FIELD_TIGHT} font-normal`} />
        </label>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={busy} className={live ? PLATE : PLATE_MAIN} data-main-room-start {...explain(live ? 'Saves who can join your live room.' : 'Goes live with the choice above: your room shows on the lists for the people it lets in.', 'People who come in see and hear what you play.', NOTE.others)} onClick={() => void announce(true)}>
          {live ? '[ SAVE ]' : '[ GO LIVE ]'}
        </button>
        {live ? (
          <button type="button" disabled={busy} className={PLATE} data-main-room-private {...explain('Takes your room off the lists, back to private.', 'Nobody new can come in; your music keeps playing for you.')} onClick={() => void announce(false)}>
            [ GO PRIVATE ]
          </button>
        ) : null}
        <span className="font-bold" role="status" data-main-room-said>
          {said}
        </span>
      </div>
      {fault !== null ? (
        <p className="w-fit bg-bubble-pale px-1 font-bold text-ink-bar" role="alert">
          {fault}
        </p>
      ) : null}
    </div>
  );
}
