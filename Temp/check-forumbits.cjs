/*
 * FORUMBITS (list 4, from a Claude test run Luke passed on): post formatting and #tags, the PREFERENCES
 * window keeping off a page's main keys, and a profile tab named after the person (run from the root):
 *   npx tsc app/lib/forum/post-format.ts app/lib/forum/song-link.ts app/lib/forum/news-feed.ts app/lib/ui/clear-main-keys.ts app/lib/profile/profile-title.ts app/lib/forum/mock-repository.ts app/components/PostText.tsx --rootDir app --outDir Temp/forumbits-out --module commonjs --target es2020 --moduleResolution node --jsx react-jsx --skipLibCheck --esModuleInterop --strict
 *   node Temp/check-forumbits.cjs
 *
 * 1. Luke's 3A: **bold**, *italic*, http/https links and #tag words, read by our own parser into pieces and
 *    drawn as React elements (never HTML); old words read as written; #tags are filed as the post's tags
 *    by the repositories (the mock is run here; the Supabase payloads are read for the same call).
 * 2. Luke's 4B: PREFERENCES stays open across pages but hops off a page's main key ("+ NEW POST").
 * 3. The profile tab: the display name, plain words for a hidden or unknown account, never the id.
 */
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

// The mock repository keeps its board in this browser's storage.
const store = new Map();
globalThis.window = globalThis;
globalThis.localStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key),
  clear: () => store.clear(),
};

const OUT = './forumbits-out';
const { parsePost, postWords, hashTagsIn } = require(`${OUT}/lib/forum/post-format.js`);
const { bodyWords } = require(`${OUT}/lib/forum/song-link.js`);
const { clipForNews } = require(`${OUT}/lib/forum/news-feed.js`);
const { clearPlace } = require(`${OUT}/lib/ui/clear-main-keys.js`);
const PostText = require(`${OUT}/components/PostText.js`).default;

const html = (body) => renderToStaticMarkup(React.createElement(PostText, { body }));

async function main() {
  // --- 1. formatting -------------------------------------------------------------------------------
  const report = html('**bold** and *italic* see https://example.com/a_b?x=1. #testtag');
  assert.match(report, /<strong class="font-bold">bold<\/strong>/, 'two stars make bold');
  assert.match(report, /<em class="italic">italic<\/em>/, 'one star makes italic');
  assert.match(
    report,
    /<a href="https:\/\/example\.com\/a_b\?x=1" target="_blank" rel="noopener noreferrer nofollow"[^>]*>https:\/\/example\.com\/a_b\?x=1<\/a>\./,
    'a link is clickable, opened safely, its full stop left outside',
  );
  assert.match(report, /<a [^>]*href="\/forum#tag-testtag"[^>]*>#testtag<\/a>/, 'a #tag links to the board filtered by it');
  assert.doesNotMatch(report, /\*\*/, 'no stars left on screen');

  // Never HTML: markup in a post is shown as the characters it is.
  const hostile = html('<img src=x onerror=alert(1)> **<b>hi</b>** javascript:alert(1) [x](javascript:alert(1))');
  assert.doesNotMatch(hostile, /<img|<b>|href="javascript/i, 'markup and javascript: never reach the page as HTML');
  assert.match(hostile, /&lt;img/, 'markup is escaped text');
  assert.doesNotMatch(html('see http://'), /<a /, 'a bare scheme is not a link');
  assert.doesNotMatch(html('ftp://example.com/x'), /<a /, 'only http and https are links');

  // Bold holding italic and a link; a link holding stars stays one link.
  const nested = html('**big *small* https://x.example/a**');
  assert.match(nested, /<strong class="font-bold">big <em class="italic">small<\/em> <a href="https:\/\/x\.example\/a"/, 'italic and a link inside bold');
  assert.match(html('(see https://en.wikipedia.org/wiki/Foo_(bar))'), /href="https:\/\/en\.wikipedia\.org\/wiki\/Foo_\(bar\)"/, 'a bracket the link opened stays in it');
  assert.match(html('(see https://example.com/x)'), /href="https:\/\/example\.com\/x"[^>]*>https:\/\/example\.com\/x<\/a>\)/, 'a bracket around a link stays outside it');

  // Old posts read as they were written.
  for (const old of [
    '5*3*2 = 30',
    'a * b * c',
    'snake_*case* stays',
    '***three stars***',
    '** loose **',
    'issue #5 and C# and x#y',
    'two\nlines *not\nitalic*',
    'https://debaser-site.vercel.app/beatbox#abc',
  ]) {
    assert.equal(postWords(old), old, `old words unchanged: ${JSON.stringify(old)}`);
    assert.doesNotMatch(html(old), /<strong|<em/, `no emphasis in ${JSON.stringify(old)}`);
  }
  assert.doesNotMatch(html('issue #5 and C# and x#y'), /#tag-/, 'numbers, C# and a # inside a word are not tags');
  assert.doesNotMatch(html('https://example.com/page#section'), /#tag-section/, 'an address fragment is not a tag');
  assert.match(html('line one\nline two'), /line one\nline two/, 'line breaks stay');

  // Previews and clips lose the stars.
  assert.equal(postWords('**Hello** *there* #lore'), 'Hello there #lore');
  assert.equal(bodyWords('**Hello** *there*'), 'Hello there', 'the collapsed row and gallery show words, not stars');
  assert.equal(clipForNews('**great** *song*\nhere'), 'great song here', 'a reply clipped for the wire, the slider or a profile loses its stars too');

  // #tags as labels.
  assert.deepEqual(hashTagsIn('#testtag and #World-Building, #testtag again, (#lore)'), ['TESTTAG', 'WORLD BUILDING', 'LORE']);
  assert.deepEqual(hashTagsIn('#a1 #b2 #c3 #d4 #e5 #f6 #g7').length, 6, 'at most six tags from words');
  assert.deepEqual(hashTagsIn('#thisisfarfartoolongtobeatagword'), [], 'a word over 24 characters is not a tag');
  assert.deepEqual(hashTagsIn('**#bold** tag'), ['BOLD'], 'a tag inside bold still files');
  assert.ok(parsePost('x'.repeat(30000) + ' **b**').every((piece) => piece.kind !== 'bold'), 'a huge post skips emphasis, quickly');

  // The mock repository files the #tags as the post's tags, and a reply's.
  const { getMockForumRepository } = require(`${OUT}/lib/forum/mock-repository.js`);
  const forum = getMockForumRepository();
  const author = { id: 'mock-author', displayName: 'Tester' };
  const anchor = { kind: 'board', id: 'board', label: 'BOARD' };
  const thread = await forum.createThread({ title: 'Formatting', body: '**bold** #testtag', anchor, author });
  const keys = thread.tags.map((tag) => tag.label);
  assert.ok(keys.includes('TESTTAG'), `the post carries #testtag as a tag: ${keys.join(', ')}`);
  assert.equal(thread.body, '**bold** #testtag', 'the words are stored as written');
  const replied = await forum.addComment({ threadId: thread.id, body: 'me too #Second', author });
  assert.ok(replied.comment.tags.some((tag) => tag.label === 'SECOND'), 'a reply files its #tag');

  // The Supabase repository makes the same call in all three places a post or reply is written.
  const supabase = readFileSync('app/lib/forum/supabase-repository.ts', 'utf8');
  assert.equal((supabase.match(/mergeTags\(\[\.\.\.\(input\.userTags \?\? \[\]\), \.\.\.hashTagsIn\(input\.body\)\]/g) ?? []).length, 3, 'Supabase files #tags for a post, a reply and an item thread');
  assert.doesNotMatch(supabase, /mergeTags\(input\.userTags \?\? \[\]/, 'no write path skips the #tags');

  // The board draws posts and replies through PostText.
  assert.match(readFileSync('app/components/ForumThreadCard.tsx', 'utf8'), /<PostText body=\{layout\.right\.body\}/);
  assert.match(readFileSync('app/components/CommentNodeCard.tsx', 'utf8'), /<PostText body=\{comment\.body\}/);

  // --- 2. PREFERENCES keeps off the main keys -----------------------------------------------------
  const area = { left: 0, top: 40, right: 1440, bottom: 812 };
  const newPost = { left: 1300, top: 180, right: 1420, bottom: 212 };
  const prefs = { x: 1048, y: 168, w: 384, h: 620 };
  const moved = clearPlace(prefs, [newPost], area);
  assert.ok(moved !== null, 'a window on + NEW POST moves');
  const covers = (r, k) => r.x < k.right + 8 && r.x + r.w > k.left - 8 && r.y < k.bottom + 8 && r.y + r.h > k.top - 8;
  assert.ok(!covers(moved, newPost), `it no longer covers the key: ${JSON.stringify(moved)}`);
  assert.equal(moved.w, 384, 'it keeps its size');
  assert.equal(moved.h, 620, 'it keeps its size');
  assert.ok(moved.x >= 0 && moved.x + moved.w <= 1440 && moved.y >= 40 && moved.y + moved.h <= 812, 'it stays on screen, above the bar');
  assert.equal(clearPlace({ x: 20, y: 300, w: 384, h: 400 }, [newPost], area), null, 'a window clear of the keys stays put');
  assert.equal(clearPlace(prefs, [], area), null, 'a page with no main keys moves nothing');
  const preferences = readFileSync('app/components/PreferencesWindow.tsx', 'utf8');
  // By its layout name, `preferences-tall` since it opened taller (SETTINGSUI, 2026-11-17): the name the layout store knows it by.
  assert.match(preferences, /clearMainKeys\(PREFERENCES_LAYOUT\)/, 'PREFERENCES runs the check');
  assert.match(preferences, /\[open, layoutIsReady, pathname\]/, 'on opening and on every new page');
  assert.match(readFileSync('app/components/ForumBoard.tsx', 'utf8'), /data-main-key\s*>\s*\+ NEW POST/, '+ NEW POST is marked as the board\'s main key');

  // --- 3. the profile tab --------------------------------------------------------------------------
  const page = readFileSync('app/profile/[userId]/page.tsx', 'utf8');
  assert.doesNotMatch(page, /Profile \$\{id\}/, 'the tab never shows the id');
  const { profileTitle, PROFILE_TITLE_FALLBACK } = require(`${OUT}/lib/profile/profile-title.js`);
  const id = '44661640-1234-4abc-8def-0123456789ab';
  process.env.NEXT_PUBLIC_PROFILE_DATA_SOURCE = 'mock';
  assert.equal(await profileTitle(id), PROFILE_TITLE_FALLBACK, 'mock accounts live in the browser: plain words');
  assert.equal(await profileTitle('debaser-site'), `${PROFILE_TITLE_FALLBACK} :: debaser.site`, 'the house account by name');

  process.env.NEXT_PUBLIC_PROFILE_DATA_SOURCE = 'supabase';
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'public-test-key';
  let answer = null;
  let asked = 0;
  globalThis.fetch = async (url) => {
    asked += 1;
    // The account list, not the profile row: a visitor's key may read a name but not the hidden mark (live, 2026-11-16).
    assert.match(String(url), /\/rest\/v1\/rpc\/account_list\?select=display_name%2Chidden&id=eq\./, 'asks the account list for one name');
    return new Response(answer === null ? '' : JSON.stringify(answer), {
      status: answer === null ? 406 : 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  answer = { display_name: 'good morning', hidden: false };
  assert.equal(await profileTitle(id), `${PROFILE_TITLE_FALLBACK} :: good morning`, 'a person by their display name');
  answer = { display_name: 'TEST ACCOUNT A', hidden: true };
  assert.equal(await profileTitle(id), PROFILE_TITLE_FALLBACK, 'a hidden account gets plain words');
  answer = null;
  assert.equal(await profileTitle(id), PROFILE_TITLE_FALLBACK, 'an unknown account gets plain words');
  const before = asked;
  assert.equal(await profileTitle('not-a-real-id'), PROFILE_TITLE_FALLBACK, 'a malformed id gets plain words');
  assert.equal(asked, before, 'a malformed id is never sent to the database');
  globalThis.fetch = async () => {
    throw new Error('offline');
  };
  assert.equal(await profileTitle(id), PROFILE_TITLE_FALLBACK, 'a failed lookup gets plain words');
  for (const title of [PROFILE_TITLE_FALLBACK]) assert.ok(!title.includes(id));

  console.log('FORUMBITS: formatting, #tags, PREFERENCES off the main keys, profile tab titles - all pass');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
