'use client';

import { useEffect, useState } from 'react';
import { SONG_NOTE_MAX, songOwner } from '../lib/audio/song-notes';
import type { AudioTrack } from '../lib/audio/tracks';
import { getMusicRepository } from '../lib/audio/repository';
import { rememberSongNote, useSongNote } from '../lib/audio/use-song-note';
import { displayCrop } from '../lib/profile/avatar-crop';
import { usePublicProfile } from '../lib/profile/use-public-profile';
import { currentAvatarVersion } from '../lib/profile/visibility';
import { artSlot } from '../lib/ui/art/slots';
import { FIELD, PLATE, PLATE_MAIN } from '../lib/ui/controls';
import { getWebRepository } from '../lib/web/repository';
import { rowAddresses } from '../lib/web/row-addresses';
import type { WebItem } from '../lib/web/types';
import { parseWebAudioSrc } from '../lib/web/web-audio';
import { useAuth } from './AuthProvider';
import PopoutWindow from './PopoutWindow';
import ProfileAvatar from './ProfileAvatar';
import SpriteSlot from './SpriteSlot';

/** A song with no picture of its own and no uploader (a hand-filed file): an art slot until Luke files one. */
const NO_COVER_SRC = `/${artSlot('web-thumb-missing')?.path ?? 'assets/web/thumb-missing.png'}`;
/** The cover's box on the card, in pixels. */
const COVER = 160;

/**
 * The cover card (SPEC-music-queues.md): a room's screen while a song plays, in a look of its own (a grey ground,
 * coloured words; the `cover-card` tokens). The song's cover and a short description, from wherever the song is:
 *
 * - archive audio: the platform's own thumbnail (hotlinked, never copied) and plain-text description, as the
 *   archive shows them;
 * - the site's own MP3s: the picture and words their uploader added, else the uploader's profile picture; the
 *   uploader sees `[ EDIT CARD ]` here (and COVER CARD in the song's menu) to add or change them;
 * - a hand-filed song: an art slot until a picture is filed.
 */
export default function SongCoverCard({ track, fit }: { track: AudioTrack; fit: string }) {
  const { user } = useAuth();
  const owner = songOwner(track.id);
  const note = useSongNote(owner === null ? null : track.id);
  const web = useWebCover(track.src);
  const [editing, setEditing] = useState(false);

  const picture = web?.picture ?? note?.pictureSrc ?? null;
  const words = web?.description ?? note?.description ?? null;

  return (
    <div className={`flex flex-col items-center justify-center gap-2 bg-cover-card p-4 text-center ${fit}`} data-watch-song data-cover-card>
      <span className="block shrink-0 overflow-hidden" style={{ width: COVER, height: COVER }}>
        {picture !== null ? (
          // eslint-disable-next-line @next/next/no-img-element -- an archive thumbnail is hotlinked (SPEC-web.md); an uploader's picture is the site's own image
          <img src={picture} alt="" width={COVER} height={COVER} referrerPolicy="no-referrer" className="block h-full w-full object-cover" data-cover-picture />
        ) : owner !== null ? (
          <UploaderFace userId={owner} />
        ) : (
          <SpriteSlot src={NO_COVER_SRC} alt="" width={COVER} height={COVER} title="No cover yet" fallback={<span aria-hidden="true" className="flex h-full w-full items-center justify-center text-label text-cover-card-ink">NO COVER</span>} />
        )}
      </span>
      <span className="text-key font-bold text-cover-card-title">♪ {track.title}</span>
      {track.credit.length > 0 ? <span className="text-label text-cover-card-ink">{track.credit}</span> : null}
      {/* Third-party words as plain text, never as HTML (CLAUDE.md); cut to a few lines on the card. */}
      {words !== null ? <span className="line-clamp-4 max-w-md wrap-anywhere text-label text-cover-card-ink" data-cover-words>{words}</span> : null}
      {owner !== null && user !== null && user.id === owner ? (
        <button type="button" className={PLATE} onClick={() => setEditing(true)} data-cover-edit>
          [ EDIT CARD ]
        </button>
      ) : null}
      {editing && owner !== null ? <SongCardEditor track={track} ownerId={owner} onClose={() => setEditing(false)} /> : null}
    </div>
  );
}

/** The uploader's own profile picture, for a song they gave none. */
function UploaderFace({ userId }: { userId: string }) {
  const { profile, ready } = usePublicProfile(userId);
  return (
    <span className="flex h-full w-full items-center justify-center" data-cover-uploader>
      <ProfileAvatar version={currentAvatarVersion(profile)} displayName={ready ? profile.displayName : ''} size={COVER} variant="plain" hideVersionLabel crop={displayCrop(profile)} />
    </span>
  );
}

const webCovers = new Map<string, Promise<WebItem | null>>();

/** Archive audio's cover and words, from its archive row; null for anything else (or a row not found). */
function useWebCover(src: string): { picture: string | null; description: string | null } | null {
  const parsed = parseWebAudioSrc(src);
  const key = parsed === null ? null : `${parsed.platform}:${parsed.externalId}`;
  const [found, setFound] = useState<{ key: string; item: WebItem | null } | null>(null);
  useEffect(() => {
    if (parsed === null || key === null) return;
    let read = webCovers.get(key);
    if (read === undefined) {
      read = getWebRepository()
        .getItemByExternal(parsed.platform, parsed.externalId)
        .catch(() => {
          webCovers.delete(key);
          return null;
        });
      webCovers.set(key, read);
    }
    let current = true;
    void read.then((item) => {
      if (current) setFound({ key, item });
    });
    return () => {
      current = false;
    };
    // `key` stands for `parsed`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  if (key === null || found === null || found.key !== key || found.item === null) return null;
  return { picture: rowAddresses(found.item).thumb ?? null, description: found.item.description?.trim() || null };
}

/**
 * The uploader's pop-up (SPEC-music-queues.md): a picture for their song (an image upload, kept like the site's other
 * images, under their own folder) and a short description. Offered on the card and in the song's own menu.
 */
export function SongCardEditor({ track, ownerId, onClose }: { track: AudioTrack; ownerId: string; onClose: () => void }) {
  const note = useSongNote(track.id);
  const [file, setFile] = useState<File | null>(null);
  const [dropPicture, setDropPicture] = useState(false);
  const [text, setText] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const shown = text ?? note?.description ?? '';

  async function save() {
    setBusy(true);
    setProblem(null);
    try {
      const saved = await getMusicRepository().saveSongNote({ trackId: track.id, ownerId, picture: file ?? (dropPicture ? null : 'keep'), description: shown });
      rememberSongNote(saved);
      onClose();
    } catch (failure) {
      setProblem(failure instanceof Error ? failure.message : 'THE CARD COULD NOT BE SAVED.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <PopoutWindow title={`COVER CARD :: ${track.title}`} onClose={onClose} maxWidth="max-w-md">
      <form
        className="flex flex-col gap-2 p-2 text-left text-label text-ink"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
        data-cover-editor
      >
        <label className="flex flex-col gap-1">
          <span className="font-bold">PICTURE (PNG, JPG, WEBP OR GIF)</span>
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            onChange={(event) => {
              setFile(event.target.files?.[0] ?? null);
              setDropPicture(false);
            }}
            className="text-label"
            data-cover-file
          />
        </label>
        {note?.pictureSrc && file === null ? (
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={dropPicture} onChange={(event) => setDropPicture(event.target.checked)} />
            TAKE THE PICTURE OFF (YOUR PROFILE PICTURE SHOWS INSTEAD)
          </label>
        ) : null}
        <label className="flex flex-col gap-1">
          <span className="font-bold">A FEW WORDS ABOUT IT</span>
          <textarea value={shown} maxLength={SONG_NOTE_MAX} rows={4} onChange={(event) => setText(event.target.value)} className={FIELD} data-cover-text />
        </label>
        {problem === null ? null : (
          <p className="w-fit bg-bubble-pale px-1 font-bold text-ink-bar" role="alert">
            {problem}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <button type="submit" className={PLATE_MAIN} disabled={busy} data-cover-save>
            {busy ? '[ SAVING... ]' : '[ SAVE ]'}
          </button>
          <button type="button" className={PLATE} onClick={onClose}>
            [ CANCEL ]
          </button>
        </div>
      </form>
    </PopoutWindow>
  );
}
