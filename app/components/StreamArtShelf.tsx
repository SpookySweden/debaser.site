'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { displayCrop } from '../lib/profile/avatar-crop';
import { usePublicProfile } from '../lib/profile/use-public-profile';
import { currentAvatarVersion } from '../lib/profile/visibility';
import { artSlot } from '../lib/ui/art/slots';
import { PLATE, PLATE_PRESSED } from '../lib/ui/controls';
import { CanvasRaster, placementsOf, replayOrder, type CanvasInput } from '../lib/watch/canvas';
import { getCanvasRepository, type CanvasSnapshot, type CanvasTimelineInput, type StreamArtPiece } from '../lib/watch/canvas-repository';
import { useAuth } from './AuthProvider';
import ArtMark from './ArtMark';
import CanvasPicture from './CanvasPicture';
import { useAdmin } from './ForumModerationControls';
import PopoutWindow from './PopoutWindow';
import ProfileAvatar from './ProfileAvatar';
import { isGuestLabel } from '../lib/watch/rules';
import ProfileLink from './ProfileLink';
import { usePresence } from './PresenceProvider';
import StatusDot from './StatusDot';
import TimeStamp from './TimeStamp';

/** The crown over a participant who held one (`mark-crown-filled`), shown at 16px. */
const CROWN_SRC = `/${artSlot('mark-crown-filled')?.path ?? 'assets/icons/crown-filled.png'}`;
const CROWN_SIZE = 16;
/** The host's picture on a row, where language flags sit on other media. */
const HOST_PICTURE = 24;
const PARTICIPANT_PICTURE = 56;
/** A whole replay takes about this long, however many inputs it has: a step every 30 to 250 ms. */
const REPLAY_MS = 20_000;
const REPLAY_STEP_MIN_MS = 30;
const REPLAY_STEP_MAX_MS = 250;

/**
 * STREAM ART in the archive (SPEC-stream-art.md): every saved room canvas, newest saved first. Each shows its
 * latest snapshot, credited the way the media catalogue credits a file, and the host's picture where language
 * flags sit on other media; the picture opens everybody who was there. OPEN shows the piece: the final snapshot
 * and the full timeline replayable stroke by stroke, then every snapshot, timed, dated and credited. Only the house
 * account gets `[ HIDE ]`, which takes a piece off the archive without wiping it. Read in the browser, never saved
 * into the archive's stream.
 */
export default function StreamArtShelf() {
  const admin = useAdmin();
  const [pieces, setPieces] = useState<StreamArtPiece[] | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [open, setOpen] = useState<StreamArtPiece | null>(null);
  const [people, setPeople] = useState<StreamArtPiece | null>(null);

  const load = useCallback(() => {
    getCanvasRepository()
      .listPieces({ includeHidden: admin })
      .then((found) => {
        setPieces(found);
        setFailed(null);
      })
      .catch((failure: unknown) => setFailed(failure instanceof Error ? failure.message : 'STREAM ART COULD NOT BE READ.'));
  }, [admin]);
  useEffect(() => load(), [load]);

  return (
    <section aria-label="Stream art" data-stream-art>
      {failed !== null ? (
        <p role="alert" className="w-fit bg-bubble-pale px-1 text-label font-bold text-ink-bar">
          {failed}
        </p>
      ) : pieces === null ? (
        <p role="status" className="text-label font-bold text-ink-quiet">
          READING...
        </p>
      ) : pieces.length === 0 ? (
        <p role="status" className="text-label font-bold text-ink">
          NOTHING SAVED YET.
        </p>
      ) : (
        <ul aria-label="Stream art, newest first">
          {pieces.map((piece) => (
            <PieceRow key={piece.canvas.id} piece={piece} admin={admin} onOpen={() => setOpen(piece)} onPeople={() => setPeople(piece)} onChanged={load} />
          ))}
        </ul>
      )}
      {open === null ? null : <PieceWindow piece={open} onClose={() => setOpen(null)} onPeople={() => setPeople(open)} />}
      {people === null ? null : <ParticipantsWindow piece={people} onClose={() => setPeople(null)} />}
    </section>
  );
}

function PieceRow({ piece, admin, onOpen, onPeople, onChanged }: { piece: StreamArtPiece; admin: boolean; onOpen: () => void; onPeople: () => void; onChanged: () => void }) {
  const { user } = useAuth();
  const { canvas, latest } = piece;
  const [busy, setBusy] = useState(false);
  const [fault, setFault] = useState<string | null>(null);

  const hide = (hidden: boolean) => {
    if (user === null) return;
    setBusy(true);
    setFault(null);
    getCanvasRepository()
      .setHidden(canvas.id, hidden, user.id)
      .then(onChanged)
      .catch((failure: unknown) => setFault(failure instanceof Error ? failure.message : 'THAT DID NOT WORK.'))
      .finally(() => setBusy(false));
  };

  return (
    <li className="rule-pixel py-2" data-stream-art-piece={canvas.id}>
      <div className="flex flex-wrap items-start gap-2">
        <button type="button" onClick={onOpen} className="block w-40 shrink-0 cursor-pointer border border-ink" aria-label={`Open ${canvas.title}`}>
          <CanvasPicture source={{ kind: 'image', url: latest?.imageUrl ?? null }} placements={latest?.placements ?? []} className="aspect-video w-full" />
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <button type="button" onClick={onOpen} className="min-w-0 cursor-pointer text-left text-sm font-bold text-ink hover:underline">
              {canvas.title}
            </button>
            {/* The host's picture, where language flags sit on other media: it opens everybody who was there. */}
            <button type="button" onClick={onPeople} className="inline-flex shrink-0 cursor-pointer" title="Everybody who was there" aria-label={`Everybody in ${canvas.hostLabel}'s room`} data-stream-art-host>
              <PersonPicture id={canvas.hostId} label={canvas.hostLabel} size={HOST_PICTURE} />
            </button>
            {canvas.hidden ? <span className="w-fit bg-bubble-pale px-1 text-label font-bold text-ink-bar">HIDDEN</span> : null}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-label text-ink">
            {canvas.savedBy === null ? null : (
              <span>
                SAVED BY <ProfileLink author={{ id: canvas.savedBy, displayName: canvas.savedByLabel ?? 'Unknown' }} className="font-bold" />{' '}
                {canvas.savedAt === null ? null : <TimeStamp at={canvas.savedAt} />}
              </span>
            )}
            <span>{`${piece.snapshotCount} SNAPSHOT${piece.snapshotCount === 1 ? '' : 'S'}`}</span>
          </div>
          {latest !== null && latest.credits.length > 0 ? <Credits credits={latest.credits} /> : null}
          {fault === null ? null : <p className="mt-1 w-fit bg-bubble-pale px-1 text-label font-bold text-ink-bar">{fault}</p>}
        </div>
        <span className="flex shrink-0 items-center gap-1 max-sm:w-full max-sm:justify-start max-sm:pl-42">
          <button type="button" onClick={onOpen} className={PLATE}>
            [ OPEN ]
          </button>
          {admin ? (
            <button type="button" disabled={busy} onClick={() => hide(!canvas.hidden)} className={PLATE} data-stream-art-hide>
              {canvas.hidden ? '[ SHOW ]' : '[ HIDE ]'}
            </button>
          ) : null}
        </span>
      </div>
    </li>
  );
}

/** DRAWN BY ..., each name a link to the profile. */
function Credits({ credits }: { credits: CanvasSnapshot['credits'] }) {
  return (
    <p className="mt-0.5 text-label text-ink wrap-anywhere">
      DRAWN BY{' '}
      {credits.map((credit, index) => (
        <span key={`${credit.id ?? credit.label}-${index}`}>
          {index === 0 ? null : ', '}
          <ProfileLink author={{ id: isGuestLabel(credit.label) ? null : credit.id, displayName: credit.label }} className="font-bold" />
        </span>
      ))}
    </p>
  );
}

/** Somebody's profile picture, as their profile has it. */
function PersonPicture({ id, label, size }: { id: string; label: string; size: number }) {
  const { profile } = usePublicProfile(id);
  return <ProfileAvatar version={currentAvatarVersion(profile)} displayName={label} size={size} variant="plain" hideVersionLabel crop={displayCrop(profile)} />;
}

/* --- everybody who was there ------------------------------------------------------------------------ */

function ParticipantsWindow({ piece, onClose }: { piece: StreamArtPiece; onClose: () => void }) {
  const people = piece.participants.length > 0 ? piece.participants : [{ id: piece.canvas.hostId, label: piece.canvas.hostLabel, crowned: true }];
  return (
    <PopoutWindow title={`WHO WAS THERE :: ${piece.canvas.title}`} onClose={onClose} maxWidth="max-w-xl">
      <ul className="flex flex-wrap gap-3 p-3" aria-label="Everybody who was there" data-stream-art-people>
        {people.map((person) => (
          <Participant key={person.id} id={person.id} label={person.label} crowned={person.crowned} />
        ))}
      </ul>
    </PopoutWindow>
  );
}

function Participant({ id, label, crowned }: { id: string; label: string; crowned: boolean }) {
  const { status, record, noLamp } = usePresence(id);
  return (
    <li className="flex w-20 flex-col items-center gap-0.5" data-stream-art-person={id} data-crowned={crowned ? 'yes' : 'no'}>
      {/* The crown sits on top of the picture when they held one; the space is kept either way. */}
      <span className="flex h-4 items-end justify-center text-label text-ink" aria-label={crowned ? 'Crowned' : undefined}>
        {crowned ? <ArtMark src={CROWN_SRC} size={CROWN_SIZE} fallback={<span className="leading-none">♛</span>} /> : null}
      </span>
      <Link href={`/profile/${encodeURIComponent(id)}`} className="block hover:bg-ice-pale" title={`Open ${label}'s public profile`}>
        <PersonPicture id={id} label={label} size={PARTICIPANT_PICTURE} />
      </Link>
      <span className="flex max-w-full items-center gap-1 text-label text-ink">
        {noLamp ? null : <StatusDot status={status ?? 'offline'} record={record} />}
        <Link href={`/profile/${encodeURIComponent(id)}`} className="truncate font-bold hover:underline">
          {label}
        </Link>
      </span>
    </li>
  );
}

/* --- one piece: the final snapshot, the replay, every snapshot ------------------------------------------ */

function PieceWindow({ piece, onClose, onPeople }: { piece: StreamArtPiece; onClose: () => void; onPeople: () => void }) {
  const [snapshots, setSnapshots] = useState<CanvasSnapshot[] | null>(null);
  const [inputs, setInputs] = useState<CanvasTimelineInput[] | null>(null);
  const [fault, setFault] = useState<string | null>(null);
  const id = piece.canvas.id;

  useEffect(() => {
    const repository = getCanvasRepository();
    let current = true;
    Promise.all([repository.listSnapshots(id), repository.readInputs(id)])
      .then(([shots, timeline]) => {
        if (!current) return;
        setSnapshots(shots);
        setInputs(replayOrder(timeline));
      })
      .catch((failure: unknown) => {
        if (current) setFault(failure instanceof Error ? failure.message : 'THIS PIECE COULD NOT BE READ.');
      });
    return () => {
      current = false;
    };
  }, [id]);

  const finalShot = snapshots === null ? piece.latest : (snapshots[snapshots.length - 1] ?? null);
  const [replaying, setReplaying] = useState(false);

  return (
    <PopoutWindow title={piece.canvas.title} badge="STREAM ART" onClose={onClose} maxWidth="max-w-3xl">
      <div className="space-y-2 p-2 text-ink" data-stream-art-window>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={replaying ? PLATE : PLATE_PRESSED} aria-pressed={!replaying} onClick={() => setReplaying(false)}>
            [ FINAL ]
          </button>
          <button type="button" className={replaying ? PLATE_PRESSED : PLATE} aria-pressed={replaying} disabled={inputs === null || inputs.length === 0} onClick={() => setReplaying(true)} data-stream-art-replay-key>
            [ TIMELINE ]
          </button>
          <span className="flex-1" />
          <button type="button" onClick={onPeople} className="inline-flex cursor-pointer items-center gap-1 text-label font-bold" title="Everybody who was there">
            <PersonPicture id={piece.canvas.hostId} label={piece.canvas.hostLabel} size={HOST_PICTURE} />
            WHO WAS THERE
          </button>
        </div>
        {fault === null ? null : <p className="w-fit bg-bubble-pale px-1 text-label font-bold text-ink-bar">{fault}</p>}
        {replaying && inputs !== null ? (
          <Replay inputs={inputs} />
        ) : (
          <div className="border border-ink">
            <CanvasPicture source={{ kind: 'image', url: finalShot?.imageUrl ?? null }} placements={finalShot?.placements ?? []} className="aspect-video w-full" label="The final snapshot" />
          </div>
        )}
        {finalShot === null ? null : <SnapshotCredit shot={finalShot} final />}

        <h3 className="title-line text-label text-ink">SNAPSHOTS</h3>
        {snapshots === null ? (
          <p className="text-label text-ink-quiet">READING...</p>
        ) : snapshots.length === 0 ? (
          <p className="text-label text-ink">NONE YET.</p>
        ) : (
          <ol className="grid grid-cols-2 gap-2 sm:grid-cols-3" aria-label="Snapshots, oldest first">
            {snapshots.map((shot, index) => (
              <li key={shot.id} className="space-y-0.5" data-stream-art-snapshot>
                <div className="border border-ink">
                  <CanvasPicture source={{ kind: 'image', url: shot.imageUrl }} placements={shot.placements} className="aspect-video w-full" />
                </div>
                <p className="text-label font-bold text-ink">{`SNAPSHOT ${index + 1}`}</p>
                <SnapshotCredit shot={shot} />
              </li>
            ))}
          </ol>
        )}
      </div>
    </PopoutWindow>
  );
}

/** When, by whom, and who drew what is in it: the media catalogue's FILED BY line. */
function SnapshotCredit({ shot, final = false }: { shot: CanvasSnapshot; final?: boolean }) {
  return (
    <div className="text-label text-ink">
      <span>
        {final ? 'FINAL SNAPSHOT, TAKEN BY ' : 'TAKEN BY '}
        <ProfileLink author={{ id: shot.takenBy, displayName: shot.takenByLabel }} className="font-bold" /> <TimeStamp at={shot.takenAt} />
      </span>
      {shot.credits.length > 0 ? <Credits credits={shot.credits} /> : null}
    </div>
  );
}

/** The whole timeline, stroke by stroke: play it, or drag the line to any step. */
function Replay({ inputs }: { inputs: readonly CanvasInput[] }) {
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(true);
  const raster = useRef<{ raster: CanvasRaster; at: number }>({ raster: new CanvasRaster(), at: 0 });
  // The pixels at this step, made when the picture asks: forward one step at a time onto the same pixels,
  // backwards from the start again.
  const pixelsAt = useCallback(() => {
    const held = raster.current;
    if (step < held.at) {
      held.raster = new CanvasRaster();
      held.at = 0;
    }
    for (; held.at < step; held.at += 1) held.raster.apply(inputs[held.at]);
    return held.raster;
  }, [step, inputs]);

  const every = Math.min(REPLAY_STEP_MAX_MS, Math.max(REPLAY_STEP_MIN_MS, Math.round(REPLAY_MS / Math.max(1, inputs.length))));
  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => {
      setStep((value) => {
        if (value >= inputs.length) {
          setPlaying(false);
          return value;
        }
        return value + 1;
      });
    }, every);
    return () => window.clearInterval(timer);
  }, [playing, every, inputs.length]);

  const placements = useMemo(() => placementsOf(inputs.slice(0, step)).map((entry) => entry.place), [inputs, step]);
  const shown = inputs[step - 1];

  return (
    <div className="space-y-1" data-stream-art-replay={step}>
      <div className="border border-ink">
        <CanvasPicture source={{ kind: 'raster', raster: pixelsAt, version: step }} placements={placements} className="aspect-video w-full" label="The timeline, replayed" />
      </div>
      <div className="flex flex-wrap items-center gap-2 text-label text-ink">
        <button
          type="button"
          className={PLATE}
          onClick={() => {
            if (step >= inputs.length) setStep(0);
            setPlaying((value) => !value);
          }}
          aria-label={playing ? 'Pause the replay' : 'Play the replay'}
        >
          {playing ? '[ ❚❚ ]' : '[ ▶ ]'}
        </button>
        <input
          type="range"
          aria-label="Replay step"
          min={0}
          max={inputs.length}
          step={1}
          value={step}
          onChange={(event) => {
            setPlaying(false);
            setStep(Number(event.target.value));
          }}
          className="min-w-24 flex-1 accent-sun"
        />
        <span className="shrink-0 tabular-nums">{`${step} / ${inputs.length}`}</span>
      </div>
      <p className="min-h-5 text-label text-ink-quiet">
        {shown === undefined ? 'THE BLANK CANVAS' : `${shown.authorLabel.toUpperCase()} :: ${WORDS[shown.kind]}`}
        {shown === undefined ? null : (
          <>
            {' '}
            <TimeStamp at={shown.at} />
          </>
        )}
      </p>
    </div>
  );
}

const WORDS: Record<CanvasInput['kind'], string> = { stroke: 'DREW', erase: 'RUBBED OUT', undo: 'UNDID', place: 'PLACED' };
