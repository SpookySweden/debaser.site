'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { BALLOON_MS, BALLOON_START, balloonClear, balloonDismiss, balloonNow, balloonStep, type BalloonState } from '../lib/notifications/balloon';
import { notificationLine } from '../lib/notifications/feed';
import { notificationHref } from '../lib/notifications/links';
import { useNotifySettings } from '../lib/notifications/notify-settings-store';
import { PLATE } from '../lib/ui/controls';
import { openNotificationMenu } from './NotificationBell';
import { useNotifications } from './NotificationsProvider';

/**
 * The balloon (SPEC-notifications.md, answer 4A): a notification that arrives while the site is open pops up at the
 * bottom right, above the music bar, like an old Windows tray balloon. It appears and goes at once (no slide, no fade),
 * stays 6 seconds (longer while the pointer is on it), one at a time with `+2 MORE` for the rest. BALLOONS in
 * PREFERENCES turns it off. Messages keep their own pop-up (CommsNotifier); they are not in this feed.
 */
export default function NotificationBalloon() {
  const { userId } = useNotifications();
  // Keyed by the account, so a new sign-in starts clean: what was already in its feed is history.
  return userId === null ? null : <Balloon key={userId} />;
}

function Balloon() {
  const notifications = useNotifications();
  const { userId, items, ready, markRead } = notifications;
  const { prefs } = useNotifySettings(userId);
  const router = useRouter();
  const [state, setState] = useState<BalloonState>(BALLOON_START);
  const [held, setHeld] = useState(false);

  // Each new feed (or a flip of BALLOONS) is stepped once, as it is drawn: React's "adjust state when a prop changes".
  const [stepped, setStepped] = useState<{ items: typeof items; balloons: boolean } | null>(null);
  if (userId !== null && ready && (stepped?.items !== items || stepped.balloons !== prefs.balloons)) {
    setStepped({ items, balloons: prefs.balloons });
    const visible = typeof document === 'undefined' || document.visibilityState === 'visible';
    setState((current) => balloonStep(current, items, visible, prefs.balloons));
  }

  const { item, more } = balloonNow(state, items);

  // Six seconds, counted again from the moment the pointer leaves.
  useEffect(() => {
    if (item === null || held) return;
    const timer = window.setTimeout(() => setState(balloonDismiss), BALLOON_MS);
    return () => window.clearTimeout(timer);
  }, [item, held]);

  if (item === null) return null;

  const href = notificationHref(item);

  return (
    <div
      role="status"
      aria-live="polite"
      data-notification-balloon={item.kind}
      data-companion-avoid
      onPointerEnter={() => setHeld(true)}
      onPointerLeave={() => setHeld(false)}
      className="frame fixed z-50 w-80 max-w-full bg-sun-pale p-2 text-key text-ink"
      style={{ bottom: 'calc(var(--music-top, 0px) + 0.5rem)', right: '0.5rem' }}
    >
      <p className="break-words">{notificationLine(item)}</p>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        {href === null ? null : (
          <button
            type="button"
            className={PLATE}
            onClick={() => {
              void markRead(item.id);
              setState(balloonDismiss);
              setHeld(false);
              router.push(href);
            }}
          >
            [ OPEN ]
          </button>
        )}
        {more > 0 ? (
          <button
            type="button"
            className={PLATE}
            onClick={() => {
              setState(balloonClear);
              setHeld(false);
              openNotificationMenu();
            }}
          >
            [ +{more} MORE ]
          </button>
        ) : null}
        <button
          type="button"
          className={`${PLATE} ml-auto`}
          aria-label="Close this notification"
          title="CLOSE"
          onClick={() => {
            setState(balloonDismiss);
            setHeld(false);
          }}
        >
          [ × ]
        </button>
      </div>
    </div>
  );
}
