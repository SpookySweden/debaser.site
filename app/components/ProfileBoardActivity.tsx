'use client';

import Link from 'next/link';
import { threadDomId } from '../lib/forum/anchors';
import { countReplies } from '../lib/forum/format';
import type { ForumThread } from '../lib/forum/types';
import ProfileName from './ProfileName';
import TimeStamp from './TimeStamp';

type ProfileBoardActivityProps = {
  userId: string;
  displayName: string;
  /** The swatch the account picked, so its name reads the same here as on the board. */
  nameColour?: string;
  threads: ForumThread[];
};

/** Public board activity: the threads this account filed, newest first. */
export default function ProfileBoardActivity({
  userId,
  displayName,
  nameColour,
  threads,
}: ProfileBoardActivityProps) {
  return (
    <section className="frame bg-sun-pale">
      <div className="title-line text-accent-ink">
        <span>BOARD ACTIVITY</span>
        <span>[ {threads.length} THREADS ]</span>
      </div>

      <div className="p-3 text-ink">
        {threads.length === 0 ? (
          <p className="text-label font-bold text-ink">
            <ProfileName author={{ id: userId, displayName }} colour={nameColour} lamp={false}>
              {displayName.toUpperCase()}
            </ProfileName>{' '}
            HAS NOT FILED ANYTHING ON THE BOARD YET.
          </p>
        ) : (
          <ul className="space-y-1">
            {threads.slice(0, 8).map((thread) => (
              <li key={thread.id} className="text-label font-bold">
                <Link href={`/forum#${threadDomId(thread.id)}`} className="underline hover:bg-ice">
                  [<TimeStamp at={thread.createdAt} />] {thread.title}
                </Link>
                <span className="ml-1 text-ink">:: {countReplies(thread.comments.length)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
