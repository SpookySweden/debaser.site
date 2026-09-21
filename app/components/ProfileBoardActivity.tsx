'use client';

import Link from 'next/link';
import { threadDomId } from '../lib/forum/anchors';
import { countReplies, formatStamp } from '../lib/forum/format';
import type { ForumThread } from '../lib/forum/types';

type ProfileBoardActivityProps = {
  userId: string;
  displayName: string;
  threads: ForumThread[];
};

/** Public board activity: the threads this account filed, newest first. */
export default function ProfileBoardActivity({ userId, displayName, threads }: ProfileBoardActivityProps) {
  return (
    <section className="rounded-none border-2 border-t-white border-l-white border-r-gray-800 border-b-gray-800 bg-[#c0c0c0]">
      <div className="flex items-center justify-between bg-[#000080] px-2 py-1 text-xs font-bold text-white">
        <span>BOARD ACTIVITY</span>
        <span>[ {threads.length} THREADS ]</span>
      </div>

      <div className="p-3 text-black">
        {threads.length === 0 ? (
          <p className="text-[10px] font-bold text-black">
            {displayName.toUpperCase()} HAS NOT FILED ANYTHING ON THE BOARD YET.
          </p>
        ) : (
          <ul className="space-y-1">
            {threads.slice(0, 8).map((thread) => (
              <li key={thread.id} className="text-[10px] font-bold">
                <Link href={`/forum#${threadDomId(thread.id)}`} className="underline hover:bg-gray-300">
                  [{formatStamp(thread.createdAt)}] {thread.title}
                </Link>
                <span className="ml-1 text-gray-700">:: {countReplies(thread.comments.length)}</span>
              </li>
            ))}
          </ul>
        )}

        <p className="mt-2 text-[10px] text-gray-700">
          ACCOUNT ID {userId} :: READ FROM THE BOARD, SO IT STAYS TRUE IF A PICTURE OR BIO CHANGES.
        </p>
      </div>
    </section>
  );
}
