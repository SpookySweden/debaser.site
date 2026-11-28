'use client';

import { buildNewsFeed } from '../lib/forum/news-feed';
import { useForum } from './ForumProvider';
import NewsCrawl from './NewsCrawl';
import { PLATE, TITLE_BAR } from '../lib/ui/controls';
import { noteSettingChanged, subscribeToAccountSettings } from '../lib/settings/settings-bus';
import { useEffect, useState } from 'react';
import { explain } from '../lib/ui/explain';

/**
 * The wire: everything filed on the board, crawling across one strip.
 *
 * It is the shape the page had room for. The board's posts are tall rectangles and its
 * threads are lists, but a strip across the width of the window is a line, and a line is what
 * a wire is - so the same material the thread cards are made of goes past in single rows: the
 * little picture, the name, `[ POST ]` or `[ REPLY ]`, the time, and the words.
 *
 * Three details make it work rather than annoy: it holds its breath while the pointer is over
 * it (so a row can be read, and a link aimed at), each row links to the thread it came from,
 * and the crawl stops entirely for anybody who has asked their system to reduce motion - in
 * which case the strip is simply a line that can be scrolled by hand. Those live in
 * ./NewsCrawl, which a profile's own feed uses too.
 *
 * It is drawn as one more panel of the board - the same plate, the same navy title bar as the
 * composer and the list - rather than as a black display of its own: the strip is the board's
 * front page, not a piece of equipment bolted to it, and the two wires on the site should read
 * as the same thing seen from two pages.
 *
 * A post a moderator has pinned comes first and goes past with a `PINNED` plate on it, so the
 * announcement is what a reader sees whichever part of the run they happen to catch.
 *
 * With nothing pinned the wire is not drawn at all: an empty strip saying so was one more line a
 * phone had to scroll past before the first post (SPEC-efficiency.md). How to read it is the crawl's
 * hover tip rather than a line under it.
 */
export default function NewsTicker() {
  const forum = useForum();
  // Pinned first, then the newest posts and replies (SPEC-forum-v2.md, Luke's 8A: pins alone left it empty most days).
  const items = buildNewsFeed(forum.threads, 64, { pins: forum.pins, newest: WIRE_NEWEST });
  /** `[ ❚❚ ]` stops the crawl and `[ ▶ ]` starts it, remembered in this browser (8A). Read after the first paint. */
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    const read = () => {
      try {
        setPaused(window.localStorage.getItem(WIRE_PAUSED_KEY) === '1');
      } catch {
        // No storage: the wire moves, and the key still stops it for this visit.
      }
    };
    const frame = window.requestAnimationFrame(read);
    // Signed in, the account's choice arrives in storage on sign-in (SPEC-forum-v3.md, F2A).
    const unsubscribe = subscribeToAccountSettings(read);
    return () => {
      window.cancelAnimationFrame(frame);
      unsubscribe();
    };
  }, []);

  const togglePaused = () => {
    const next = !paused;
    setPaused(next);
    try {
      window.localStorage.setItem(WIRE_PAUSED_KEY, next ? '1' : '0');
    } catch {
      // Kept for this visit only.
    }
    noteSettingChanged('wirePaused');
  };

  if (items.length === 0) return null;

  return (
    <section>
      <div className={TITLE_BAR}>
        <span>NEWSWIRE</span>
      </div>

      <div className="flex items-center gap-1">
        {/* Gone under reduced motion, where the wire is already a still list (./NewsCrawl.tsx). */}
        <button
          type="button"
          onClick={togglePaused}
          aria-pressed={paused}
          aria-label={paused ? 'Start the newswire' : 'Stop the newswire'}
          title={paused ? 'Start the newswire' : 'Stop the newswire'}
          className={`${PLATE} hit shrink-0 motion-reduce:hidden`}
          data-wire-pause
          {...explain(paused ? 'Starts the newswire crawling again.' : 'Stops the newswire crawling along.', paused ? 'This browser remembers your choice.' : 'This browser remembers your choice.')}
        >
          {paused ? '[ ▶ ]' : '[ ❚❚ ]'}
        </button>
        <NewsCrawl items={items} paused={paused} className="min-w-0 flex-1 overflow-hidden px-1 py-0.75" />
      </div>
    </section>
  );
}

/** How many of the newest posts and replies follow the pins. */
const WIRE_NEWEST = 12;
const WIRE_PAUSED_KEY = 'debaser.forum.wire-paused.v1';
