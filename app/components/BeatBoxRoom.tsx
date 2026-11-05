'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { BeatBox, type BeatBoxArt, type SavedSong } from '../features/beatbox';
import BeatBoxSongs from './BeatBoxSongs';
import ShareSongToForum from './ShareSongToForum';
import { PLATE } from '../lib/ui/controls';

// Where Luke's drawings go (app/lib/ui/art/slots.ts). Until a file is there, its space stays empty.
const ART: BeatBoxArt = {
  recordLight: '/assets/beatbox/record-light.png',
  channelIcons: [1, 2, 3, 4].map((channel) => `/assets/beatbox/channel-${channel}.png`),
  emptyState: '/assets/beatbox/empty-bar.png',
};

/** A song link keeps the song after the #, which never reaches the server unless someone posts it. */
function songInAddress(): string | undefined {
  const hash = window.location.hash;
  return hash.length > 1 ? hash : undefined;
}

export default function BeatBoxRoom() {
  // A new number starts the beat box afresh with the song, as opening a saved one replaces what's there.
  const [opened, setOpened] = useState(() => ({ number: 0, song: songInAddress() }));
  const [shareLinkStart] = useState(() => `${window.location.origin}/beatbox`);

  const openSaved = useCallback((song: string) => {
    setOpened((current) => ({ number: current.number + 1, song: `#${song}` }));
  }, []);

  // Coming from the forum's [ OPEN SONG ], the address only changes once this page has been drawn. A hand-edited
  // address changes it while the page is open.
  useEffect(() => {
    const follow = () => {
      const song = songInAddress();
      if (song !== undefined) {
        setOpened((current) => (current.song === song ? current : { number: current.number + 1, song }));
      }
    };
    const timer = setTimeout(follow);
    window.addEventListener('hashchange', follow);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('hashchange', follow);
    };
  }, []);

  const extras = useCallback(
    (getSong: () => SavedSong) => (
      <>
        <BeatBoxSongs getSong={getSong} onOpen={openSaved} />
        <ShareSongToForum getSong={getSong} />
      </>
    ),
    [openSaved],
  );

  return (
    <div className="flex flex-col gap-3 select-text">
      <BeatBox
        key={opened.number}
        initialSong={opened.song}
        shareLinkStart={shareLinkStart}
        extras={extras}
        art={ART}
        hideTitle
      />
      <div className="px-3 pb-3">
        <Link href="/beatbox/credits" className={PLATE}>
          [ CREDITS ]
        </Link>
      </div>
    </div>
  );
}
