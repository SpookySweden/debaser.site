/*
 * WEB Phase 5, run offline (SPEC-web.md; run by `npm run checks:web`, part of `npm run verify`):
 *   npx tsc app/lib/web/bridges.ts app/lib/watch/mock-watch-repository.ts app/lib/watch/supabase-watch-repository.ts app/lib/forum/mock-repository.ts app/lib/forum/supabase-repository.ts app/lib/forum/thread-subject.ts app/lib/forum/board-query.ts app/lib/forum/board-search.ts app/lib/web/mock-web-repository.ts app/lib/web/supabase-web-repository.ts --outDir Temp/out-web-bridges --rootDir app --module commonjs --target es2022 --lib es2022,dom --skipLibCheck --esModuleInterop --moduleResolution node
 *
 * The forum bridge:
 * - anchor round-trip: an item's anchor is `web` + `web_items.id` + its title, reads back to the same id,
 *   links to the MEDIA page (/media; /web, then /archive, until 2026-11-04) even when stored
 *   without its link (the Supabase rows keep no href), and a malformed id
 *   or another kind reads as no item
 * - both forum repositories file one thread per item: the second comment answers the first's thread,
 *   two items get two threads, and the Supabase one writes `anchor_kind = 'web'` to the (stand-in) table
 * - the board's source filter and its `in:archive` search find WEB threads and nothing else; `in:web`, typed
 *   before the rename, still does
 * - gone items: a thread's subject is the WEB kind; found = live, read-and-absent = gone, still reading or
 *   a failed read = not gone; the Supabase `getItem` treats a hidden row (RLS) as absent and throws on a
 *   failed read, the mock finds its own items
 *
 * The watch-room bridge:
 * - platform -> source_kind: every WEB platform is mapped; the Internet Archive is `embed`; only video and
 *   audio are queued; the link is the row's own allow-listed embed, never `file`/`hls`/`dash`
 * - host allow-list: `officialEmbedUrl` refuses http, other hosts, look-alike hosts, other paths, queries,
 *   fragments, credentials and overlong addresses; a hostile item yields no link
 * - both watch repositories refuse a bad link before writing anything (the Supabase one never reaches
 *   its insert), and take a good one
 */
const { join } = require('node:path');

const ROOT = join(__dirname, '..');
const OUT = join(ROOT, 'Temp', 'out-web-bridges');
const lib = (...parts) => join(OUT, 'lib', ...parts);

process.exitCode = 1;
let passed = 0;
const fail = (message) => {
  console.log(`FAIL ${message}`);
  process.exit(1);
};
const ok = (condition, message) => {
  if (!condition) fail(message);
  passed += 1;
};
const same = (a, b, message) => ok(JSON.stringify(a) === JSON.stringify(b), `${message} (got ${JSON.stringify(a)})`);

/* ------------------------------------------------------------ stand-ins: browser storage, Supabase */
const storage = new Map();
global.window = {
  localStorage: {
    getItem: (key) => (storage.has(key) ? storage.get(key) : null),
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: (key) => storage.delete(key),
  },
  setTimeout,
  clearTimeout,
  addEventListener() {},
  removeEventListener() {},
  dispatchEvent() {
    return true;
  },
};

/** A small PostgREST over in-memory tables: just the calls the repositories under test make. */
const writes = [];
function fakeClient(tables, { failReads = false, unique = {} } = {}) {
  let nextId = 1;
  const from = (table) => {
    const q = { table, filters: [], insert: null, columns: null, limit: null };
    const rows = () => {
      if (!tables[table]) tables[table] = [];
      return tables[table];
    };
    const shape = (row) => {
      if (table === 'forum_threads' && typeof q.columns === 'string' && q.columns.includes('forum_comments')) {
        return { ...row, forum_comments: (tables.forum_comments ?? []).filter((c) => c.thread_id === row.id) };
      }
      return { ...row };
    };
    const run = () => {
      if (q.insert !== null) {
        writes.push({ table, row: q.insert });
        const key = unique[table];
        if (key && key.when(q.insert) && rows().some((row) => key.when(row) && key.cols.every((c) => row[c] === q.insert[c]))) {
          return { data: null, error: { message: 'duplicate key value violates unique constraint' } };
        }
        const row = { id: `row-${nextId++}`, created_at: new Date(Date.UTC(2026, 9, 31, 12, 0, nextId)).toISOString(), ...q.insert };
        rows().push(row);
        return { data: [shape(row)], error: null };
      }
      if (failReads) return { data: null, error: { message: 'offline' } };
      let found = rows().filter((row) => q.filters.every((f) => f(row)));
      if (q.limit !== null) found = found.slice(0, q.limit);
      return { data: found.map(shape), error: null };
    };
    const builder = {
      select(columns) {
        q.columns = columns;
        return builder;
      },
      insert(row) {
        q.insert = row;
        return builder;
      },
      eq(column, value) {
        q.filters.push((row) => row[column] === value);
        return builder;
      },
      not() {
        return builder;
      },
      order() {
        return builder;
      },
      limit(n) {
        q.limit = n;
        return builder;
      },
      single() {
        const { data, error } = run();
        return Promise.resolve(error ? { data: null, error } : data.length === 1 ? { data: data[0], error: null } : { data: null, error: { message: 'not one row' } });
      },
      maybeSingle() {
        const { data, error } = run();
        return Promise.resolve(error ? { data: null, error } : { data: data[0] ?? null, error: null });
      },
      then(resolve, reject) {
        return Promise.resolve(run()).then(resolve, reject);
      },
    };
    return builder;
  };
  return { from, channel: () => ({ on() { return this; }, subscribe() { return this; } }), removeChannel: async () => undefined, rpc: async () => ({ data: null, error: null }) };
}

// Every repository asks this module for its client: the stand-in answers instead of the real browser one.
let currentClient = null;
require.cache[lib('supabase', 'client.js')] = {
  id: lib('supabase', 'client.js'),
  filename: lib('supabase', 'client.js'),
  loaded: true,
  exports: { getSupabaseBrowserClient: () => currentClient, supabaseAuthStorageKey: () => null, isSupabaseConfigured: true },
};

const bridges = require(lib('web', 'bridges.js'));
const { webAnchor, webAnchorItemId, webItemStatus, watchLinkForItem, officialEmbedUrl, isQueueableWebLink, WATCH_KIND_BY_PLATFORM, ITEM_GONE_NOTE, WEB_HREF } = bridges;
const { resolveAnchorTarget } = require(lib('forum', 'anchors.js'));
const { queueRefusal, LINK_REFUSALS, recognizeLink } = require(lib('watch', 'links.js'));
const { PLATFORM_HOSTS } = require(lib('web', 'hosts.js'));
const { MOCK_WEB_ITEMS, getMockWebRepository } = require(lib('web', 'mock-web-repository.js'));
const { createSupabaseWebRepository } = require(lib('web', 'supabase-web-repository.js'));
const { WEB_ITEM_COLUMNS } = require(lib('web', 'rows.js'));
const { threadSubject } = require(lib('forum', 'thread-subject.js'));
const { selectBoardThreads } = require(lib('forum', 'board-query.js'));
const { searchBoard, parseSearch, IN_PLACES } = require(lib('forum', 'board-search.js'));

const run = async () => {
  /* ------------------------------------------------------------------------ anchor round-trip */
  const item = MOCK_WEB_ITEMS.find((candidate) => candidate.embedUrl !== undefined);
  ok(item !== undefined, 'the mock has an item with a player');
  const anchor = webAnchor(item);
  same([anchor.kind, anchor.id, anchor.label, anchor.href], ['web', item.id, item.title, '/media'], 'anchor is web + web_items.id + title + /archive');
  same(webAnchorItemId(anchor), item.id, 'anchor reads back to the item id');
  same(webAnchorItemId({ kind: 'web', id: anchor.id, label: 'x' }), item.id, 'a row read back without its link still finds the item');
  same(resolveAnchorTarget({ kind: 'web', id: anchor.id, label: anchor.label }).href, WEB_HREF, 'a stored web anchor with no href links to the archive');
  same(WEB_HREF, '/media', 'the search page is /media (it was /web, then /archive)');
  same(webAnchorItemId({ kind: 'track', id: item.id }), null, 'another kind is no WEB item');
  for (const bad of ['', 'internet_archive', 'internet_archive:', 'Internet_Archive:x', 'internet_archive:../x', 'internet_archive:a b', 'a:-x', `internet_archive:${'x'.repeat(201)}`]) {
    same(webAnchorItemId({ kind: 'web', id: bad }), null, `malformed id ${JSON.stringify(bad)} is no item`);
  }
  same(webAnchor({ id: item.id, title: '  A \n\t B  ' }).label, 'A B', 'the label is the title, whitespace collapsed');
  ok(webAnchor({ id: item.id, title: 'x'.repeat(500) }).label.length === 200, 'the label is capped at 200');
  same(webAnchor({ id: item.id, title: '   ' }).label, item.id, 'an empty title falls back to the id');

  /* ------------------------------------------------- one thread per item, both forum repositories */
  const author = { id: 'test-user', displayName: 'TEST ACCOUNT A' };
  const other = MOCK_WEB_ITEMS.find((candidate) => candidate.id !== item.id);
  const otherAnchor = webAnchor(other);

  const { getMockForumRepository } = require(lib('forum', 'mock-repository.js'));
  const mockForum = getMockForumRepository();
  const m1 = await mockForum.addComment({ body: 'first word', author, anchor });
  const m2 = await mockForum.addComment({ body: 'second word', author, anchor });
  const m3 = await mockForum.addComment({ body: 'other item', author, anchor: otherAnchor });
  ok(m1.createdThread && !m2.createdThread && m3.createdThread, 'mock forum: first comment files the thread, second answers it, another item files its own');
  same(m2.thread.id, m1.thread.id, 'mock forum: one thread per item');
  ok(m3.thread.id !== m1.thread.id, 'mock forum: two items, two threads');
  same([m2.thread.anchor.kind, m2.thread.anchor.id, m2.thread.comments.length], ['web', item.id, 2], 'mock forum: the thread is the item\'s, with both comments');

  const forumTables = { forum_threads: [], forum_comments: [] };
  currentClient = fakeClient(forumTables, {
    unique: { forum_threads: { cols: ['anchor_kind', 'anchor_id'], when: (row) => row.anchor_kind !== 'board' } },
  });
  const { getSupabaseForumRepository } = require(lib('forum', 'supabase-repository.js'));
  const supaForum = getSupabaseForumRepository();
  const s1 = await supaForum.addComment({ body: 'first word', author, anchor });
  const s2 = await supaForum.addComment({ body: 'second word', author, anchor });
  const s3 = await supaForum.addComment({ body: 'other item', author, anchor: otherAnchor });
  ok(s1.createdThread && !s2.createdThread && s3.createdThread, 'supabase forum: first files, second answers, another item files its own');
  same(s2.thread.id, s1.thread.id, 'supabase forum: one thread per item');
  same(forumTables.forum_threads.map((row) => [row.anchor_kind, row.anchor_id, row.anchor_label]), [['web', item.id, item.title], ['web', other.id, other.title]], 'supabase forum: the rows keep web + id + title');
  same(s2.thread.anchor, { kind: 'web', id: item.id, label: item.title }, 'supabase forum: the thread reads back as the WEB anchor');
  same(resolveAnchorTarget(s2.thread.anchor).href, '/media', 'supabase forum: the read-back thread links to /media');

  /* --------------------------------------------------------------------------- board filters */
  const board = { ...m1.thread, id: 'board-thread', title: 'A BOARD POST', body: 'words', anchor: { kind: 'board', id: 'board-general', label: 'GENERAL BOARD' }, comments: [] };
  const threads = [m2.thread, m3.thread, board];
  const filtered = selectBoardThreads(threads, { query: '', sourceFilter: 'web', tagKeys: [], tagMode: 'any', sort: 'new' });
  same(filtered.map((thread) => thread.id).sort(), [m2.thread.id, m3.thread.id].sort(), 'the board\'s WEB THREADS filter finds the WEB threads only');
  same(IN_PLACES.find((place) => place.value === 'media')?.label, 'MEDIA THREADS', 'in:media is offered, as MEDIA THREADS');
  ok(!IN_PLACES.some((place) => place.value === 'web'), 'in:web is no longer offered (the word is media now)');
  for (const word of ['in:media', 'in:archive', 'in:web']) {
    const hits = searchBoard(threads, parseSearch(word));
    const hitThreads = [...new Set(hits.map((hit) => (hit.thread ?? hit.unit?.thread ?? {}).id))];
    ok(hitThreads.length > 0 && hitThreads.every((id) => id === m2.thread.id || id === m3.thread.id), `${word} finds WEB threads only (got ${JSON.stringify(hitThreads)})`);
  }

  /* ------------------------------------------------------------------------------- gone items */
  same(threadSubject(m2.thread)?.kind, 'web', 'a WEB thread\'s subject is the WEB kind');
  same(webItemStatus(anchor, item), 'live', 'found: live');
  same(webItemStatus(anchor, null), 'gone', 'read and absent (hidden or deleted): gone');
  same(webItemStatus(anchor, undefined), 'checking', 'still reading or a failed read: not called gone');
  same(webItemStatus(anchor, other), 'gone', 'a different item back is not this one');
  same(webItemStatus({ kind: 'web', id: 'not an id' }, undefined), 'gone', 'a malformed id is gone without a read');
  ok(/ITEM GONE/.test(ITEM_GONE_NOTE), 'the note says ITEM GONE');

  same((await getMockWebRepository().getItem(item.id))?.id, item.id, 'mock getItem finds its item');
  same(await getMockWebRepository().getItem('internet_archive:no-such-item'), null, 'mock getItem: absent is null');

  const hiddenRow = { id: 'internet_archive:hidden', enabled: false };
  const liveRow = { id: item.id, platform: 'internet_archive', external_id: item.externalId, kind: item.kind, url: item.url, canonical_url: item.canonicalUrl, title: item.title, creator: null, description: null, thumbnail_url: null, embed_url: item.embedUrl, license_url: null, duration_seconds: null, tags: null, published_at: item.publishedAt, fetched_at: item.fetchedAt, enabled: true };
  // Row Level Security: anon reads see enabled rows only, so the stand-in table is what they would see.
  const visible = [liveRow, hiddenRow].filter((row) => row.enabled);
  writes.length = 0;
  const webRepo = createSupabaseWebRepository(() => fakeClient({ web_items: visible }));
  same((await webRepo.getItem(item.id))?.id, item.id, 'supabase getItem finds a visible item');
  same(await webRepo.getItem('internet_archive:hidden'), null, 'supabase getItem: a hidden row reads as absent (gone)');
  let threw = false;
  try {
    await createSupabaseWebRepository(() => fakeClient({ web_items: visible }, { failReads: true })).getItem(item.id);
  } catch {
    threw = true;
  }
  ok(threw, 'supabase getItem throws on a failed read, so a thread never calls it gone for that');
  same(writes.length, 0, 'getItem writes nothing');
  void WEB_ITEM_COLUMNS;

  /* ------------------------------------------------------------- platform -> source_kind mapping */
  same(Object.keys(WATCH_KIND_BY_PLATFORM).sort(), Object.keys(PLATFORM_HOSTS).sort(), 'every WEB platform has a room mapping');
  for (const [platform, kind] of Object.entries(WATCH_KIND_BY_PLATFORM)) {
    ok(kind === null || ['youtube', 'vimeo', 'twitch', 'embed'].includes(kind), `${platform} maps to a player kind, never a media file (${kind})`);
  }
  same(WATCH_KIND_BY_PLATFORM.internet_archive, 'embed', 'the Internet Archive has no site kind of its own: embed');
  const link = watchLinkForItem(item);
  same(link, { url: item.embedUrl, kind: 'embed', title: item.title }, 'an Archive item queues as its own official player');
  ok(isQueueableWebLink(link) && queueRefusal(link) === null, 'that link is queueable');
  for (const kind of ['image', 'text', 'other']) same(watchLinkForItem({ ...item, kind }), null, `a ${kind} item is not queued`);
  same(watchLinkForItem({ ...item, kind: 'video' })?.kind, 'embed', 'a video item is queued');
  same(watchLinkForItem({ ...item, embedUrl: undefined }), null, 'no player, no link');
  same(watchLinkForItem({ ...item, title: 'x'.repeat(400) })?.title.length, 200, 'the title fits the column (200)');
  same(watchLinkForItem({ ...item, platform: 'no_such_platform' }), null, 'an unknown platform is not queued');
  same(recognizeLink(item.embedUrl).ok, false, 'a pasted Archive address is still refused: embed comes from WEB only');

  /* ------------------------------------------------------------------------ host allow-list */
  const id = item.externalId;
  same(officialEmbedUrl(`https://archive.org/embed/${id}`), `https://archive.org/embed/${id}`, 'the Archive\'s embed address passes');
  const hostile = [
    `http://archive.org/embed/${id}`,
    `https://evil.example/embed/${id}`,
    `https://archive.org.evil.example/embed/${id}`,
    `https://evilarchive.org/embed/${id}`,
    `https://user:pw@archive.org/embed/${id}`,
    `https://archive.org/details/${id}`,
    `https://archive.org/embed/${id}/../../download/${id}`,
    `https://archive.org/embed/${id}?autoplay=1`,
    `https://archive.org/embed/${id}#x`,
    `https://archive.org:8443/embed/${id}`,
    `javascript:alert(1)`,
    `https://archive.org/embed/${'a'.repeat(2100)}`,
    42,
    null,
  ];
  for (const url of hostile) same(officialEmbedUrl(url), null, `refused: ${String(url).slice(0, 60)}`);
  for (const url of hostile.filter((value) => typeof value === 'string')) {
    same(watchLinkForItem({ ...item, embedUrl: url }), null, `a hostile item yields no link: ${url.slice(0, 60)}`);
    ok(queueRefusal({ url, kind: 'embed', title: 'x' }) !== null, `the queue refuses embed ${url.slice(0, 60)}`);
  }
  same(queueRefusal({ url: `http://archive.org/embed/${id}`, kind: 'embed', title: 'x' }), LINK_REFUSALS.notHttps, 'http is refused as not https');
  ok(!isQueueableWebLink({ url: `https://archive.org/embed/${id}`, kind: 'file', title: 'x' }), 'WEB never queues a file link');

  /* -------------------------------- media-server players as room embeds (SPEC-media-servers.md; Luke 2026-11-07) */
  // A configured server's own player page may play in a room, even though it is not an official allow-listed embed.
  // Scoped to the exact hosts in media-servers.ts (the real list is empty, so a fake one is passed here).
  const fakeServers = [{ id: 'friend_1', label: 'FRIEND 1', base: 'https://media.friend.example', listPath: '*', play: { movie: '/m/{tmdb}', tv: '/t/{tmdb}/{season}/{episode}' } }];
  const serverPlay = 'https://media.friend.example/embed/movie/157336';
  ok(bridges.isMediaServerEmbed(serverPlay, fakeServers), "a configured server's player page is a server embed");
  ok(!bridges.isMediaServerEmbed(serverPlay), 'with no servers configured (the real empty list) it is not');
  ok(!bridges.isMediaServerEmbed('https://evil.example/embed/movie/157336', fakeServers), 'another host is not a server embed');
  ok(!bridges.isMediaServerEmbed('http://media.friend.example/x', fakeServers), 'http is not');
  ok(!bridges.isMediaServerEmbed('https://media.friend.example:8443/x', fakeServers), 'a port is not');
  ok(!bridges.isMediaServerEmbed('https://user:pw@media.friend.example/x', fakeServers), 'credentials are not');
  ok(isQueueableWebLink({ url: serverPlay, kind: 'embed', title: 'A FILM' }, fakeServers), "a server's player link is queueable when its host is configured");
  ok(!isQueueableWebLink({ url: serverPlay, kind: 'embed', title: 'A FILM' }), 'but not against the empty real server list');
  ok(isQueueableWebLink(link), 'an official embed is still queueable with no server argument');
  // serverWatchLink: a TMDB title on a server becomes a room embed of that server's player page.
  const mserver = { id: 'friend_1', label: 'FRIEND 1', base: 'https://media.friend.example', listPath: '*', play: { movie: '/m/{tmdb}', tv: '/t/{tmdb}/{season}/{episode}' } };
  const mlink = bridges.serverWatchLink(mserver, { type: 'movie', tmdbId: 157336, copies: [{ server: 'friend_1' }] }, 'A FILM');
  same(mlink, { url: 'https://media.friend.example/m/157336', kind: 'embed', title: 'A FILM' }, 'a server-held title builds a sandboxed room embed');
  ok(mlink && isQueueableWebLink(mlink, [mserver]), 'and it is queueable against that server');
  ok(bridges.serverWatchLink(mserver, { type: 'movie', tmdbId: 157336, copies: [{ server: 'other' }] }, 'X') === null, 'null when the server holds no copy of the title');
  // The repositories' write check (queueRefusal) takes the same server links (2026-11-07: before, the room could play one but
  // the queue refused it as "CAN'T BE EMBEDDED").
  same(queueRefusal(mlink, [mserver]), null, "the queue's write check takes a configured server's player link");
  same(queueRefusal(mlink), LINK_REFUSALS.notEmbeddable, 'and refuses it once the server is gone from the list');
  same(queueRefusal({ url: 'https://evil.example/m/157336', kind: 'embed', title: 'X' }, [mserver]), LINK_REFUSALS.notEmbeddable, 'another host is still refused');

  /* ------------------------------------------------- both watch repositories enforce it before writing */
  const { getMockWatchRepository } = require(lib('watch', 'mock-watch-repository.js'));
  const mockWatch = getMockWatchRepository();
  await mockWatch.openRoom({ id: 'room-1', host: { id: 'test-user', label: 'TEST ACCOUNT A' }, mediaItemId: 'media-1' });
  const evil = { url: `https://evil.example/embed/${id}`, kind: 'embed', title: 'x' };
  let refusedMock = null;
  try {
    await mockWatch.addToQueue({ roomId: 'room-1', addedBy: 'test-user', position: 1, link: evil });
  } catch (error) {
    refusedMock = error.message;
  }
  same(refusedMock, LINK_REFUSALS.notEmbeddable, 'mock watch: a non-allow-listed embed is refused');
  const queued = await mockWatch.addToQueue({ roomId: 'room-1', addedBy: 'test-user', position: 1, link });
  same(queued.link, link, 'mock watch: the official player is queued');
  same((await mockWatch.readRoom('room-1')).queue.filter((entry) => entry.link !== null).length, 1, 'mock watch: only the good link is in the queue');

  const watchTables = { watch_queue: [] };
  currentClient = fakeClient(watchTables);
  writes.length = 0;
  const { getSupabaseWatchRepository } = require(lib('watch', 'supabase-watch-repository.js'));
  const supaWatch = getSupabaseWatchRepository();
  let refusedSupa = null;
  try {
    await supaWatch.addToQueue({ roomId: 'room-1', addedBy: 'test-user', position: 1, link: evil });
  } catch (error) {
    refusedSupa = error.message;
  }
  same(refusedSupa, LINK_REFUSALS.notEmbeddable, 'supabase watch: a non-allow-listed embed is refused');
  same(writes.length, 0, 'supabase watch: the refused link never reaches the insert');
  const good = await supaWatch.addToQueue({ roomId: 'room-1', addedBy: 'test-user', position: 1, link });
  same(watchTables.watch_queue.map((row) => [row.source_kind, row.source_url, row.source_title]), [['embed', link.url, link.title]], 'supabase watch: the good link is inserted as source_kind embed');
  same(good.link, link, 'supabase watch: and reads back as the same link');

  console.log(`ok: ${passed} assertions (WEB bridges: forum anchor, gone items, watch kinds, embed allow-list)`);
  // The stand-in stores keep timers (a room's heartbeat, a board's channel) that would hold Node open.
  process.exit(0);
};

run().catch((error) => fail(error && error.stack ? error.stack : String(error)));
