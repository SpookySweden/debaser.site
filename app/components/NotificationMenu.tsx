'use client';

import Link from 'next/link';
import { threadDomId } from '../lib/forum/anchors';
import {
  notificationBreakdown,
  notificationLabel,
  splitNotifications,
  unreadNotificationCount,
} from '../lib/notifications/feed';
import type { AppNotification } from '../lib/notifications/types';
import { useNotifications } from './NotificationsProvider';
import ProfileName from './ProfileName';
import TimeStamp from './TimeStamp';
import { TITLE_BAR, TITLE_BAR_BUTTON } from '../lib/ui/controls';

/**
 * What kind of news a row is, as the badge this site already uses for that: navy for a tag and
 * maroon for a reply, the same two colours the board's own plates wear (`♪ MP3` is navy, `PINNED`
 * is maroon). One look tells a reader which rows they can answer and which are somebody asking
 * them something.
 */
const KIND_BADGE: Record<AppNotification['kind'], string> = {
  tag: 'bg-[#000080]',
  reply: 'bg-[#800000]',
};

/** A group heading inside the list: the flat grey bar a Win95 list view headed a section with. */
const GROUP_HEAD = 'border-y border-gray-500 bg-[#e8e8e8] px-1 py-[2px] text-[9px] font-bold text-gray-700';

/**
 * One line of the feed.
 *
 * Everything it says comes off the row: who did it, what they did, which post, and a snippet of
 * the words. Nothing is looked up and nothing is guessed, so a notification cannot describe
 * something other than what happened.
 *
 * It is laid out as a list row rather than a paragraph - marker, kind, who, when, then the words
 * and the post - because that is what a feed of twelve of them has to be read as: down the left
 * edge the two things that differ between rows (is it new, is it a tag or a reply), down the right
 * the sentence. The tagger's name carries the presence lamp every other name in the app carries,
 * so a row can say that the account behind it is around.
 *
 * Opening one is what marks it read - a notification you have acted on is a notification you have
 * seen - and it takes the reader to the post itself, via the same `#thread-<id>` anchor the
 * board's own links use.
 */
function NotificationRow({
  item,
  onOpen,
  onDismiss,
}: {
  item: AppNotification;
  onOpen: (item: AppNotification) => void;
  onDismiss: () => void;
}) {
  const unread = item.readAt === null;
  const target = item.threadId === null ? null : `/forum#${threadDomId(item.threadId)}`;

  const body = (
    <>
      <span className="flex items-center gap-1">
        {/* The marker: filled navy while unread, flat grey once seen. */}
        <span
          {...(unread ? { 'aria-label': 'Unread', title: 'Unread' } : { 'aria-hidden': true })}
          className={`inline-block h-2 w-2 shrink-0 border ${
            unread ? 'border-black bg-[#000080]' : 'border-gray-400 bg-[#c0c0c0]'
          }`}
        />
        <span
          className={`shrink-0 px-1 text-[9px] leading-[14px] text-white ${KIND_BADGE[item.kind]}`}
          title={notificationLabel(item.kind)}
        >
          {item.kind === 'tag' ? 'TAG' : 'REPLY'}
        </span>
        <ProfileName author={{ id: item.actorId, displayName: item.actorName }} />
        <span className={unread ? 'text-black' : 'text-gray-700'}>{notificationLabel(item.kind)}</span>
        <span className="ml-auto shrink-0 font-normal text-gray-700">
          <TimeStamp at={item.createdAt} />
        </span>
      </span>

      <span className={`mt-1 block truncate ${unread ? 'text-black' : 'font-normal text-gray-700'}`}>
        {item.body.length === 0 ? '...' : `"${item.body}"`}
      </span>

      <span className="mt-[2px] block truncate font-normal text-gray-700">
        ON: {item.threadTitle.length === 0 ? 'A POST' : item.threadTitle}
      </span>
    </>
  );

  const className = `block w-full rounded-none border p-1 text-left text-[10px] font-bold ${
    unread ? 'border-gray-500 bg-white text-black' : 'border-gray-400 bg-[#e8e8e8] text-gray-700'
  } hover:bg-yellow-100 max-sm:min-h-11`;

  if (target === null) {
    return (
      <li>
        <button
          type="button"
          className={`${className} cursor-pointer`}
          onClick={() => {
            onOpen(item);
            onDismiss();
          }}
        >
          {body}
        </button>
      </li>
    );
  }

  return (
    <li>
      <Link
        href={target}
        className={`${className} cursor-pointer`}
        onClick={() => {
          onOpen(item);
          onDismiss();
        }}
      >
        {body}
      </Link>
    </li>
  );
}

/** One group of rows under its own heading. */
function NotificationGroup({
  label,
  items,
  onOpen,
  onClose,
}: {
  label: string;
  items: AppNotification[];
  onOpen: (item: AppNotification) => void;
  onClose: () => void;
}) {
  if (items.length === 0) return null;

  return (
    <section>
      <p className={GROUP_HEAD}>
        {label} :: {items.length}
      </p>
      <ul className="space-y-1 p-1">
        {items.map((item) => (
          <NotificationRow key={item.id} item={item} onOpen={onOpen} onDismiss={onClose} />
        ))}
      </ul>
    </section>
  );
}

type NotificationMenuProps = {
  /** Closes the menu: the side panel hides its panel, a phone closes its window. */
  onClose: () => void;
  /**
   * True when the menu draws its own Win95 title bar (the panel under the bell). False inside a
   * `PopoutWindow`, which already has one - two title bars on one pop-up is one too many.
   */
  chrome?: boolean;
};

/**
 * The notification menu: recent tags and replies, newest first, together.
 *
 * It is one list rather than two because recency is the only order that matters here - what is
 * waiting for an answer is at the top whichever kind it is. Unread rows carry the filled square
 * and the white row; read ones go flat and grey, so what is new is legible at a glance without
 * a separate counter to reconcile.
 *
 * Drawn as a panel and as a phone window over the same code: the bell in the side panel opens it
 * in place, and the profile button on a phone opens it in a pop-up.
 */
export default function NotificationMenu({ onClose, chrome = true }: NotificationMenuProps) {
  const notifications = useNotifications();
  const { userId, items, summary, error, ready, markRead, markAllRead, retry } = notifications;
  const unread = unreadNotificationCount(items);
  // What is waiting, then what has been seen: the two groups the list is drawn in.
  const { fresh, earlier } = splitNotifications(items);
  const breakdown = notificationBreakdown(items);
  const open = (opened: AppNotification) => {
    void markRead(opened.id);
  };

  return (
    <div className={chrome ? 'w-full rounded-none border-2 border-t-white border-l-white border-r-gray-800 border-b-gray-800 bg-[#c0c0c0]' : 'w-full'}>
      {!chrome ? null : (
        <div className={TITLE_BAR}>
          <span>NOTIFICATIONS :: {summary}</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close the notifications"
            title="Close"
            className={TITLE_BAR_BUTTON}
          >
            x
          </button>
        </div>
      )}

      {userId === null ? (
        <p className="p-2 text-[10px] font-bold text-black">
          TAGS AND REPLIES GO ACCOUNT TO ACCOUNT - SIGN IN TO BE TOLD ABOUT THEM.
        </p>
      ) : !ready ? (
        <p className="p-2 text-[10px] font-bold text-black">READING THE NOTIFICATIONS...</p>
      ) : error !== null ? (
        <div className="p-2 text-[10px] font-bold text-[#800000]">
          <p>FEED OFFLINE :: {error}</p>
          <button
            type="button"
            onClick={retry}
            className="mt-1 cursor-pointer rounded-none border-t border-l border-white border-r border-b border-black bg-[#c0c0c0] px-2 py-[2px] text-[10px] font-bold text-black hover:bg-gray-300"
          >
            [ RETRY ]
          </button>
        </div>
      ) : items.length === 0 ? (
        <p className="p-2 text-[10px] font-bold text-black">
          NOTHING HERE YET. TAGGING SOMEBODY IN A POST, OR REPLYING TO THEIR POST, IS WHAT LANDS IN THIS LIST.
        </p>
      ) : (
        // One scrolling pane for both groups, so the headings stay with their rows.
        <div className="max-h-80 overflow-y-auto">
          <NotificationGroup label="[ NEW ]" items={fresh} onOpen={open} onClose={onClose} />
          <NotificationGroup label="[ EARLIER ]" items={earlier} onOpen={open} onClose={onClose} />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-gray-500 p-1">
        <button
          type="button"
          disabled={unread === 0}
          onClick={() => {
            void markAllRead();
          }}
          className="cursor-pointer rounded-none border-t border-l border-white border-r border-b border-black bg-[#c0c0c0] px-2 py-[2px] text-[10px] font-bold text-black hover:bg-gray-300 disabled:cursor-not-allowed disabled:opacity-60"
        >
          [ MARK ALL READ ]
        </button>
        <Link
          href="/forum"
          onClick={onClose}
          className="cursor-pointer rounded-none border-t border-l border-white border-r border-b border-black bg-[#c0c0c0] px-2 py-[2px] text-[10px] font-bold text-black hover:bg-gray-300"
        >
          [ OPEN THE BOARD ]
        </Link>
        <span className="text-[10px] text-gray-700">
          {summary}
          {breakdown === '' ? '' : ` :: ${breakdown}`}
        </span>
      </div>
    </div>
  );
}
