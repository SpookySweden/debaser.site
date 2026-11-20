/*
 * SPEC-notifications.md phase 1: the balloon, rendered on the server with its providers stubbed. What it does over time
 * (history, arrivals, +N MORE, BALLOONS off) is held by Temp/check-notify-phase1.cjs and driven in a browser by
 * scripts/drive-notify.cjs; here, that it draws nothing signed out and nothing for the feed a page opens with.
 *   npx tsc app/components/NotificationBalloon.tsx --rootDir app --outDir Temp/notify-render-out --module commonjs --target es2020 --moduleResolution node --jsx react-jsx --skipLibCheck --esModuleInterop
 *   node Temp/check-notify-render.cjs
 */
const assert = require('node:assert/strict');
const path = require('node:path');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const OUT = path.join(__dirname, 'notify-render-out');
function stub(file, exports) {
  const resolved = require.resolve(path.join(OUT, file));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: { __esModule: true, ...exports } };
}

const prefs = { replies: true, letters: true, live: true, comic: false, invites: true, balloons: true, weeklyEmail: false };
const feed = { userId: null, items: [], ready: true, markRead: async () => undefined };

stub('components/NotificationsProvider.js', { useNotifications: () => feed });
stub('components/NotificationBell.js', { openNotificationMenu: () => undefined });
stub('lib/notifications/notify-settings-store.js', {
  useNotifySettings: (person) => ({ person, ready: true, prefs, watches: [], error: null }),
});
const nav = require.resolve('next/navigation');
require.cache[nav] = { id: nav, filename: nav, loaded: true, exports: { useRouter: () => ({ push: () => undefined }) } };

const NotificationBalloon = require('./notify-render-out/components/NotificationBalloon.js').default;
const render = () => renderToStaticMarkup(React.createElement(NotificationBalloon));

assert.equal(render(), '', 'signed out: no balloon');
feed.userId = 'bell';
feed.items = [{ id: 'old', userId: 'bell', kind: 'letter', actorId: 'z', actorName: 'ZEPHYR', threadId: null, threadTitle: 'SUMMER', body: '', gameId: null, inviteId: null, recommendationId: 'r1', href: null, roomId: null, createdAt: '2026-11-20T10:00:00.000Z', readAt: null }];
assert.equal(render(), '', 'an unread row already in the feed as the page opens is not a balloon');

console.log('check-notify-render: OK');
