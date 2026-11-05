'use client';

import { useCallback, useEffect, useState } from 'react';
import { LOOKS, lookClass, type LookId } from '../lib/cytube/looks';
import { saveLookChoice, useLookChoice } from '../lib/cytube/use-looks';
import { FIELD_TIGHT, PLATE, PLATE_PRESSED } from '../lib/ui/controls';
import { getWatchRepository } from '../lib/watch/repository';
import { ROOM_NAME_MAX, ROOM_TOPIC_MAX, cleanRoomWords, roomPrivacyLabel } from '../lib/watch/rules';
import type { RoomAddMode, RoomMemberRow, RoomPrivacy, WatchRoom } from '../lib/watch/types';
import { applyLocalChange } from '../lib/watch/use-watch-room';
import { watchHref } from '../lib/watch/watch-window';
import PopoutWindow from './PopoutWindow';
import RoomPrivacyPicker from './RoomPrivacyPicker';

const ADD_MODES: readonly { value: RoomAddMode; label: string }[] = [
  { value: 'anyone', label: 'ANYONE' },
  { value: 'crowns', label: 'CROWNS ONLY' },
];

const LOOK_KEYS: readonly { id: LookId | null; label: string }[] = [{ id: null, label: 'NONE' }, ...LOOKS.map((look) => ({ id: look.id, label: look.label }))];

/**
 * The room's settings (SPEC-room-settings.md), behind the cog in a room, for its host and anybody holding a crown. NAME,
 * TOPIC and WHO CAN ADD belong to the room and wait for SAVE; a window with unsaved words asks before it closes. YOUR LOOK
 * is the reader's own and saves as it is pressed, as on the STREAM page. A draft is null until touched, so a change another
 * crown saves shows here unless this person has typed over it.
 *
 * WHO CAN JOIN and CHANGE PASSWORD are the host's alone, and each takes one more press with the consequence said first. PEOPLE lists
 * who joined, with REMOVE for the host and crowns (SPEC-privacy-phase-2.md).
 */
export default function RoomSettingsWindow({ room, userId, look, onClose }: { room: WatchRoom; userId: string; look: LookId | null; onClose: () => void }) {
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [topicDraft, setTopicDraft] = useState<string | null>(null);
  const [addDraft, setAddDraft] = useState<RoomAddMode | null>(null);
  const [state, setState] = useState<{ kind: 'idle' | 'saving' | 'saved' | 'asking' } | { kind: 'refused'; reason: string }>({ kind: 'idle' });
  const [copied, setCopied] = useState<'idle' | 'copied' | 'failed'>('idle');
  const choice = useLookChoice(userId);
  const isHost = room.hostId === userId;

  /* --- who can join: the host's, saved on its own --------------------------------------------------- */

  const [privacyDraft, setPrivacyDraft] = useState<RoomPrivacy | null>(null);
  const [passwordDraft, setPasswordDraft] = useState('');
  const [privacyState, setPrivacyState] = useState<{ kind: 'idle' | 'saving' | 'saved' } | { kind: 'refused'; reason: string }>({ kind: 'idle' });
  const privacy = privacyDraft ?? room.privacy;
  const privacyChanged = privacy !== room.privacy;
  const passwordMissing = privacy === 'password' && room.privacy !== 'password' && passwordDraft.length === 0;

  async function savePrivacy() {
    setPrivacyState({ kind: 'saving' });
    try {
      await getWatchRepository().setRoomPrivacy(room.id, privacy, passwordDraft.length > 0 ? passwordDraft : null);
      applyLocalChange(room.id, { kind: 'refresh' });
      setPrivacyDraft(null);
      setPasswordDraft('');
      setPrivacyState({ kind: 'saved' });
    } catch (failure) {
      setPrivacyState({ kind: 'refused', reason: failure instanceof Error ? failure.message : 'THAT DID NOT SAVE.' });
    }
  }

  /** What the change means, said before it is made: going open never opens the past, and going private cannot take back the past. */
  const consequence =
    privacy === 'open'
      ? 'EVERYTHING SO FAR STAYS PRIVATE, THE DRAWING TOO. ONLY NEW MESSAGES AND QUEUE ITEMS ARE OPEN.'
      : room.privacy === 'open'
        ? 'FROM NOW ON ONLY. WHAT WAS SAID WHILE OPEN WAS ALREADY PUBLIC. EVERYONE SIGNED IN WHO HAS BEEN HERE STAYS IN: USE REMOVE FOR ANYONE WHO SHOULD NOT.'
        : null;

  /* --- people ---------------------------------------------------------------------------------------- */

  const [people, setPeople] = useState<RoomMemberRow[]>([]);
  const [peopleFault, setPeopleFault] = useState<string | null>(null);
  const readPeople = useCallback(() => {
    void getWatchRepository()
      .listRoomMembers(room.id)
      .then(setPeople)
      .catch(() => setPeopleFault('THE LIST COULD NOT BE READ.'));
  }, [room.id]);

  useEffect(() => {
    readPeople();
    return getWatchRepository().subscribeRoomMembers(room.id, readPeople);
  }, [room.id, readPeople]);

  async function removePerson(person: RoomMemberRow) {
    setPeopleFault(null);
    try {
      await getWatchRepository().removeFromRoom(room.id, person.userId);
      applyLocalChange(room.id, { kind: 'refresh' });
      readPeople();
    } catch (failure) {
      setPeopleFault(failure instanceof Error ? failure.message : 'THAT DID NOT WORK.');
    }
  }

  const name = nameDraft ?? room.name ?? '';
  const topic = topicDraft ?? room.topic ?? '';
  const addMode = addDraft ?? room.addMode;
  const unsaved = cleanRoomWords(name, ROOM_NAME_MAX) !== room.name || cleanRoomWords(topic, ROOM_TOPIC_MAX) !== room.topic || addMode !== room.addMode;

  async function save() {
    setState({ kind: 'saving' });
    try {
      await getWatchRepository().saveRoomSettings({ roomId: room.id, by: userId, name, topic, addMode });
      applyLocalChange(room.id, { kind: 'refresh' });
      setNameDraft(null);
      setTopicDraft(null);
      setAddDraft(null);
      setState({ kind: 'saved' });
    } catch (failure) {
      setState({ kind: 'refused', reason: failure instanceof Error ? failure.message : 'THE SETTINGS DID NOT SAVE.' });
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(new URL(watchHref({ kind: 'room', roomId: room.id }), window.location.origin).href);
      setCopied('copied');
    } catch {
      setCopied('failed');
    }
  }

  return (
    <PopoutWindow
      title="ROOM SETTINGS"
      onClose={() => (unsaved ? setState({ kind: 'asking' }) : onClose())}
      dismissOnBackdrop={false}
      windowClassName={`room-black ${lookClass(look)} [--frame-line:var(--room-lines)]`}
      titleInk="text-room-title"
    >
      <div className="flex flex-col gap-3 p-2 text-label text-ink" data-room-settings>
        <form
          noValidate
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <label className="flex flex-col gap-1 font-bold">
            ROOM NAME
            <input
              value={name}
              maxLength={ROOM_NAME_MAX}
              autoComplete="off"
              placeholder="GOES BY THE HOST'S NAME"
              onChange={(event) => {
                setNameDraft(event.target.value);
                setState({ kind: 'idle' });
              }}
              className={`${FIELD_TIGHT} min-w-0 font-normal`}
              data-room-name
            />
          </label>
          <label className="flex flex-col gap-1 font-bold">
            TOPIC
            <input
              value={topic}
              maxLength={ROOM_TOPIC_MAX}
              autoComplete="off"
              placeholder="ONE LINE ON WHAT'S ON"
              onChange={(event) => {
                setTopicDraft(event.target.value);
                setState({ kind: 'idle' });
              }}
              className={`${FIELD_TIGHT} min-w-0 font-normal`}
              data-room-topic
            />
          </label>
          <div role="radiogroup" aria-label="Who can add" className="flex flex-wrap items-center gap-1">
            <span className="font-bold">WHO CAN ADD:</span>
            {ADD_MODES.map((mode) => (
              <button
                key={mode.value}
                type="button"
                role="radio"
                aria-checked={addMode === mode.value}
                className={addMode === mode.value ? PLATE_PRESSED : PLATE}
                onClick={() => {
                  setAddDraft(mode.value);
                  setState({ kind: 'idle' });
                }}
                data-room-add-mode={mode.value}
              >
                {`[ ${mode.label} ]`}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="submit" className={PLATE} disabled={!unsaved || state.kind === 'saving'} data-room-save>
              {state.kind === 'saving' ? '[ SAVING... ]' : '[ SAVE ]'}
            </button>
            {state.kind === 'asking' ? (
              <button type="button" className={PLATE} onClick={onClose} data-room-discard>
                [ CLOSE WITHOUT SAVING ]
              </button>
            ) : null}
            <span className="font-bold" role="status" data-room-state={state.kind}>
              {state.kind === 'saved' ? 'SAVED.' : state.kind === 'asking' ? 'NOT SAVED YET.' : null}
              {state.kind === 'refused' ? <span className="bg-bubble-pale px-1 text-ink-bar">{state.reason}</span> : null}
            </span>
          </div>
        </form>

        {isHost && room.origin === 'stream' ? (
          <form
            noValidate
            className="flex flex-col gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (!passwordMissing) void savePrivacy();
            }}
            data-room-privacy-form
          >
            <RoomPrivacyPicker
              value={privacy}
              onChange={(next) => {
                setPrivacyDraft(next);
                setPrivacyState({ kind: 'idle' });
              }}
              password={passwordDraft}
              onPassword={(next) => {
                setPasswordDraft(next);
                setPrivacyState({ kind: 'idle' });
              }}
              passwordLabel={room.privacy === 'password' && privacy === 'password' ? 'CHANGE PASSWORD' : 'PASSWORD'}
            />
            {privacyChanged && consequence !== null ? <p className="font-bold">{consequence}</p> : null}
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="submit"
                className={PLATE}
                disabled={passwordMissing || privacyState.kind === 'saving' || (!privacyChanged && passwordDraft.length === 0)}
                data-room-privacy-save
              >
                {privacyChanged ? `[ MAKE IT ${roomPrivacyLabel(privacy)} ]` : '[ CHANGE PASSWORD ]'}
              </button>
              <span className="font-bold" role="status" data-room-privacy-state={privacyState.kind}>
                {privacyState.kind === 'saved' ? 'SAVED.' : null}
                {privacyState.kind === 'refused' ? <span className="bg-bubble-pale px-1 text-ink-bar">{privacyState.reason}</span> : null}
              </span>
            </div>
          </form>
        ) : (
          <p className="font-bold">WHO CAN JOIN: {roomPrivacyLabel(room.privacy)}</p>
        )}

        {people.length === 0 ? null : (
          <div className="flex flex-col gap-1" data-room-people>
            <span className="font-bold">PEOPLE:</span>
            <ul className="flex flex-col gap-1">
              {people.map((person) => (
                <li key={person.userId} className="flex flex-wrap items-center justify-between gap-2">
                  <span className="min-w-0 truncate">{person.label}</span>
                  {person.userId === room.hostId ? (
                    <span className="text-ink-quiet">HOST</span>
                  ) : person.removedAt !== null ? (
                    <span className="text-ink-quiet">REMOVED</span>
                  ) : (
                    <button type="button" className={`${PLATE} max-sm:min-h-tap`} onClick={() => void removePerson(person)} aria-label={`Remove ${person.label}`} data-room-remove={person.userId}>
                      [ REMOVE ]
                    </button>
                  )}
                </li>
              ))}
            </ul>
            {peopleFault === null ? null : <span className="w-fit bg-bubble-pale px-1 font-bold text-ink-bar" role="alert">{peopleFault}</span>}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <span className="font-bold">ROOM LINK:</span>
          <button type="button" className={PLATE} onClick={() => void copyLink()} data-room-copy-link>
            {copied === 'copied' ? '[ COPIED ]' : copied === 'failed' ? '[ COULD NOT COPY ]' : '[ COPY LINK ]'}
          </button>
        </div>

        <div role="radiogroup" aria-label="Your look" className="flex flex-wrap items-center gap-1">
          <span className="font-bold">YOUR LOOK:</span>
          {LOOK_KEYS.map((key) => (
            <button
              key={key.label}
              type="button"
              role="radio"
              aria-checked={choice.look === key.id}
              className={choice.look === key.id ? PLATE_PRESSED : PLATE}
              onClick={() => void saveLookChoice(userId, { look: key.id }).catch(() => undefined)}
              data-room-look={key.label}
            >
              {`[ ${key.label} ]`}
            </button>
          ))}
        </div>
        <p className="text-ink-quiet">YOUR LOOK IS YOURS: IT COLOURS THE ROOMS YOU HOST.</p>
      </div>
    </PopoutWindow>
  );
}
