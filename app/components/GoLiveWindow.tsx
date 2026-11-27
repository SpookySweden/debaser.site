'use client';

import { useState } from 'react';
import type { AccountUser } from '../lib/auth/types';
import type { ForumAnchor } from '../lib/forum/types';
import { FIELD_TIGHT, PLATE, PLATE_MAIN, PLATE_PRESSED } from '../lib/ui/controls';
import { placeOf, type RoomSource } from '../lib/ui/floating-player';
import { goLiveEmpty, type RoomSeries } from '../lib/watch/go-live';
import { whatToCarry } from '../lib/watch/go-live-carry';
import { noteFindInRoom } from '../lib/watch/find-in-room';
import { ROOM_NAME_MAX, ROOM_TOPIC_MAX } from '../lib/watch/rules';
import type { RoomAddMode, RoomPrivacy } from '../lib/watch/types';
import { useMusicPlayer } from './MusicPlayerProvider';
import PopoutWindow from './PopoutWindow';
import RoomPrivacyPicker from './RoomPrivacyPicker';
import { NOTE, explain } from '../lib/ui/explain';

const ADD_MODES: readonly { value: RoomAddMode; label: string }[] = [
  { value: 'anyone', label: 'ANYONE' },
  { value: 'crowns', label: 'CROWNS ONLY' },
];

/**
 * GO LIVE's two presses (SPEC-privacy-phase-2.md): the key opens this, with PRIVATE already picked, and `[ START ]` starts the room.
 * The choice has to be made here because the room does not exist until START.
 *
 * With `first` it is `[ WATCH IN ROOM ]`'s menu (SPEC-floating-player.md, part 3): it names the video and also asks the room's
 * name, topic and who can add, and the room starts with that video.
 *
 * Every START carries what you are playing and your own queue into the room (SPEC-rooms-queues.md, phase 3).
 */
export default function GoLiveWindow({
  user,
  createThread,
  first,
  findToPlay,
  screenFirst = false,
  onClose,
}: {
  user: AccountUser;
  createThread: (input: { title: string; body: string; anchor: ForumAnchor }) => Promise<{ id: string }>;
  /** The video the room starts with; `playId` finds where the viewer had got to. */
  first?: { source: RoomSource; playId: string; title: string; series?: RoomSeries };
  /** A TMDB title no server holds (find-in-room.ts): the room opens its queue searching for it (FIND TO PLAY). */
  findToPlay?: string;
  /** The floating player's own key: the video on the screen is what goes in, even with a song on the bar beside it. */
  screenFirst?: boolean;
  onClose: () => void;
}) {
  const player = useMusicPlayer();
  const [privacy, setPrivacy] = useState<RoomPrivacy>('private');
  const [name, setName] = useState('');
  const [topic, setTopic] = useState('');
  const [addMode, setAddMode] = useState<RoomAddMode>('anyone');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [fault, setFault] = useState<string | null>(null);
  const waiting = privacy === 'password' && password.length === 0;

  async function start() {
    setBusy(true);
    setFault(null);
    try {
      // The place is read now: the video has been playing on behind this window.
      const opening = first === undefined ? {} : { start: { name, topic, addMode, first: first.source, ...(first.series === undefined ? {} : { series: first.series }), place: placeOf(first.playId) } };
      // One key, one meaning (SPEC-rooms-queues.md, phase 3): what is on and your queue come with you, read now. With a
      // video named here that video is what is on, and your queue goes in behind it.
      const mine = whatToCarry(player, screenFirst);
      const carry = first === undefined ? mine : { song: null, video: null, waiting: mine.waiting };
      const roomId = await goLiveEmpty(user, createThread, { privacy, ...(privacy === 'password' ? { password } : {}), ...opening, carry });
      // An empty room started to find a title a source: open its queue searching for it as it comes up.
      if (first === undefined && findToPlay !== undefined) noteFindInRoom(roomId, findToPlay);
      onClose();
    } catch (failure) {
      setFault(failure instanceof Error ? failure.message : 'THE STREAM COULD NOT START.');
      setBusy(false);
    }
  }

  return (
    <PopoutWindow title={first === undefined ? 'GO LIVE' : 'WATCH IN ROOM'} onClose={onClose}>
      <form
        noValidate
        className="flex flex-col gap-3 p-2 text-label text-ink"
        onSubmit={(event) => {
          event.preventDefault();
          if (!waiting && !busy) void start();
        }}
        data-go-live-window
      >
        {first === undefined ? null : (
          <>
            <p className="font-bold wrap-anywhere" data-go-live-video>
              {first.title}
            </p>
            {first.series?.note ? (
              <p className="w-fit bg-bubble-pale px-1 font-bold text-ink-bar" role="status" data-go-live-series-note>
                {first.series.note.replace('ADDED', 'ADDS')}
              </p>
            ) : null}
            <label className="flex flex-col gap-1 font-bold">
              ROOM NAME
              <input value={name} maxLength={ROOM_NAME_MAX} autoComplete="off" placeholder="GOES BY YOUR NAME" onChange={(event) => setName(event.target.value)} className={`${FIELD_TIGHT} min-w-0 font-normal`} data-go-live-name />
            </label>
            <label className="flex flex-col gap-1 font-bold">
              TOPIC
              <input value={topic} maxLength={ROOM_TOPIC_MAX} autoComplete="off" placeholder="ONE LINE ON WHAT'S ON" onChange={(event) => setTopic(event.target.value)} className={`${FIELD_TIGHT} min-w-0 font-normal`} data-go-live-topic />
            </label>
            <div role="radiogroup" aria-label="Who can add" className="flex flex-wrap items-center gap-1">
              <span className="font-bold">WHO CAN ADD:</span>
              {ADD_MODES.map((mode) => (
                <button
                  key={mode.value}
                  type="button"
                  role="radio"
                  aria-checked={addMode === mode.value}
                  className={`${addMode === mode.value ? PLATE_PRESSED : PLATE} max-sm:min-h-tap`}
                  onClick={() => setAddMode(mode.value)}
                  {...explain(mode.value === 'anyone' ? 'Lets anyone in the room add to its queue.' : 'Lets only you and people you crown add to the queue.', 'WHO CAN ADD. You can change it later in the room\'s settings.')}
                  data-go-live-add-mode={mode.value}
                >
                  {`[ ${mode.label} ]`}
                </button>
              ))}
            </div>
          </>
        )}
        <RoomPrivacyPicker value={privacy} onChange={setPrivacy} password={password} onPassword={setPassword} autoFocus />
        <p>
          {privacy === 'open'
            ? 'ANYONE CAN WATCH AND TALK. IT IS LISTED WITH NAMES, AND ITS THREAD IS ON THE BOARD.'
            : privacy === 'password'
              ? 'PEOPLE NEED THE ROOM LINK AND THE PASSWORD. EVERYONE ELSE SEES ONLY THAT IT IS ON: NO NAMES AND NO WORDS.'
              : 'PEOPLE NEED THE ROOM LINK. EVERYONE ELSE SEES ONLY THAT IT IS ON: NO NAMES AND NO WORDS.'}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <button type="submit" className={PLATE_MAIN} disabled={waiting || busy} data-go-live-start {...explain('Starts your room live, with who can join as picked above.', 'It carries what you are playing and your own queue into the room.', NOTE.others)}>
            {busy ? '[ GOING LIVE... ]' : '[ START ]'}
          </button>
          {fault === null ? null : (
            <span className="w-fit bg-bubble-pale px-1 font-bold text-ink-bar" role="alert">
              {fault}
            </span>
          )}
        </div>
      </form>
    </PopoutWindow>
  );
}
