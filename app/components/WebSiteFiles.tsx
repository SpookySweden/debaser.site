'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { catalogueTrack } from '../lib/media/catalogue';
import type { CatalogueEntry, MediaKind } from '../lib/media/types';
import { artSlot } from '../lib/ui/art/slots';
import { PLATE, PLATE_LINK, PLATE_PRESSED } from '../lib/ui/controls';
import { ICON_MEDIA } from '../lib/ui/icons';
import { WEB_HREF } from '../lib/web/bridges';
import { SITE_FILES_SHOWN, SITE_SERVER_LABEL, siteFileHref } from '../lib/web/site-server';
import { useAuth } from './AuthProvider';
import { useMusicPlayer } from './MusicPlayerProvider';
import SheetImage from './SheetImage';
import { SongMenuKey, SongMenuPanel } from './SongMenu';
import SpriteSlot from './SpriteSlot';
import StreamAddKey from './StreamAddKey';

/**
 * DEBASER.SITE in an archive search: the site's own files the search finds (`siteFileMatches` in
 * app/lib/web/site-server.ts, from the catalogue the whole site shares, so a search costs no request), first, in
 * rows drawn like the archive's other rows (WebStream.tsx `WebRow`), with the server's name where another row
 * names its platform. Each plays or opens the way the media catalogue does: a track in the music bar (with its
 * song menu), a video in its own plain player or streamed to a room, a picture opened larger. Every row links to
 * the file on the catalogue page, where its uses, tags and EDIT are.
 */

const MISSING_THUMB_SRC = `/${artSlot('web-thumb-missing')?.path ?? 'assets/web/thumb-missing.png'}`;

const KIND_WORDS: Record<MediaKind, string> = { image: 'IMAGE', audio: 'AUDIO', video: 'VIDEO' };

/** Where the bar's globe sends a listener back to, for a track started here: the archive, as for any of its rows. */
const SITE_ORIGIN = { origin: 'shelf', href: WEB_HREF, where: 'ARCHIVE' } as const;

export default function WebSiteFiles({ matches }: { matches: readonly CatalogueEntry[] }) {
  const [all, setAll] = useState(false);

  if (matches.length === 0) return null;
  const shown = all ? matches : matches.slice(0, SITE_FILES_SHOWN);

  return (
    <section aria-label={`From ${SITE_SERVER_LABEL}, the site's own files`} className="mb-2" data-site-files={matches.length}>
      <p className="text-label font-bold text-ink-quiet">{`FROM ${SITE_SERVER_LABEL} :: ${matches.length} FILE${matches.length === 1 ? '' : 'S'}`}</p>
      <ul aria-label={`Files on ${SITE_SERVER_LABEL}`}>
        {/* ALL n FILES goes away when pressed, so focus moves to the first file it showed, as LOAD MORE does. */}
        {shown.map((entry, index) => (
          <SiteFileRow key={entry.item.id} entry={entry} focusFirst={all && index === SITE_FILES_SHOWN} />
        ))}
      </ul>
      {matches.length > shown.length ? (
        <button type="button" onClick={() => setAll(true)} className={`${PLATE} mt-1`}>
          {`[ ALL ${matches.length} FILES ]`}
        </button>
      ) : null}
    </section>
  );
}

function SiteFileRow({ entry, focusFirst }: { entry: CatalogueEntry; focusFirst: boolean }) {
  const { item } = entry;
  const player = useMusicPlayer();
  const { user } = useAuth();
  /** A picture opened larger, or a video's own player loaded. */
  const [open, setOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const track = item.kind === 'audio' ? catalogueTrack(item, player.queue) : undefined;
  const who = item.credit.length > 0 ? item.credit : item.uploadedByLabel;
  const title = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (focusFirst) title.current?.focus();
  }, [focusFirst]);

  return (
    <li className="rule-pixel py-2" data-site-file={item.kind}>
      <div className="flex items-start gap-2">
        {/* The same fixed box as every archive row: the picture itself, or the stand-in for sound and video. */}
        <span className="block h-18 w-24 shrink-0 overflow-hidden border border-ink-plate bg-paper">
          {item.kind === 'image' ? (
            <button
              type="button"
              onClick={() => setOpen((current) => !current)}
              aria-expanded={open}
              aria-label={open ? `Close the picture "${item.title}"` : `Open the picture "${item.title}" larger`}
              className="block h-full w-full cursor-pointer"
            >
              <SheetImage src={item.src} alt="" width={96} height={72} sizes="96px" compact fit={{ mode: 'cover' }} />
            </button>
          ) : (
            <SpriteSlot
              src={MISSING_THUMB_SRC}
              alt=""
              width={96}
              height={72}
              title="No picture"
              fallback={<span aria-hidden="true" className="flex h-full w-full items-center justify-center text-label font-bold text-ink">NO IMAGE</span>}
            />
          )}
        </span>

        <div className="min-w-0 flex-1">
          <p ref={title} tabIndex={-1} className="text-sm font-bold text-ink wrap-anywhere">
            {item.title}
          </p>
          {who.length > 0 ? <p className="text-label text-ink wrap-anywhere">{who}</p> : null}

          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-label">
            <span className="font-bold text-ink-quiet">{KIND_WORDS[item.kind]}</span>
            <time dateTime={item.createdAt} className="text-ink">
              {item.createdAt.slice(0, 10)}
            </time>
            {item.length.length === 0 ? null : <span className="text-ink">{item.length}</span>}
          </div>

          <div className="mt-1 flex flex-wrap items-center gap-1">
            <span className="bg-ice-pale px-1 text-label font-bold text-ink">{SITE_SERVER_LABEL}</span>
            {track !== undefined ? (
              <>
                <button
                  type="button"
                  onClick={() => player.play(track, SITE_ORIGIN)}
                  aria-label={`Play "${item.title}" in the music player`}
                  className={PLATE}
                >
                  [ ▶ PLAY ]
                </button>
                <SongMenuKey open={menuOpen} onToggle={() => setMenuOpen((current) => !current)} title={track.title} />
              </>
            ) : null}
            {item.kind === 'video' ? (
              <button
                type="button"
                onClick={() => setOpen((current) => !current)}
                aria-expanded={open}
                aria-label={open ? `Close the player for "${item.title}"` : `Play "${item.title}" here`}
                className={open ? PLATE_PRESSED : PLATE}
              >
                {open ? '[ ■ CLOSE ]' : '[ ▶ PLAY ]'}
              </button>
            ) : null}
            {/* Streamed the way the catalogue does it (SPEC-cytube.md): into the room you host or hold a crown in, or to CYTUBE to go live. */}
            {item.kind === 'video' && user !== null ? <StreamAddKey mediaItemId={item.id} title={item.title} /> : null}
            {item.kind === 'image' ? (
              <button
                type="button"
                onClick={() => setOpen((current) => !current)}
                aria-expanded={open}
                aria-label={open ? `Close the picture "${item.title}"` : `View "${item.title}" larger`}
                className={open ? PLATE_PRESSED : PLATE}
              >
                {open ? '[ ■ CLOSE ]' : '[ VIEW ]'}
              </button>
            ) : null}
            <Link href={siteFileHref(entry)} aria-label={`In the catalogue: "${item.title}" on the media catalogue page, where it is used`} className={PLATE_LINK}>
              {`[ ${ICON_MEDIA} IN THE CATALOGUE ]`}
            </Link>
          </div>

          {track !== undefined && menuOpen ? <SongMenuPanel track={track} fromShelf onClose={() => setMenuOpen(false)} /> : null}
        </div>
      </div>

      {/* Nothing large loads until it is asked for. What was uploaded is what plays (no transcoding). */}
      {open && item.kind === 'image' ? (
        <div className="mt-2 max-w-md border border-ink bg-paper">
          <SheetImage src={item.src} alt={item.title} width={item.width ?? 352} height={item.height ?? 352} sizes="(max-width: 640px) 90vw, 448px" />
        </div>
      ) : null}
      {open && item.kind === 'video' ? (
        <video controls preload="metadata" src={item.src} className="mt-2 block w-full max-w-md border border-ink bg-ink-plate">
          <track kind="captions" />
        </video>
      ) : null}
    </li>
  );
}
