/*
 * COMIC's screens rendered (SPEC-comic.md, phase 1): the contents, a chapter's column, the FOLLOW key, the studio and its tabs,
 * the lore page's comic parts. A server render with the comic's data handed in (the mock store's own seed), as a visitor and
 * as the house account. What a browser does after that (COMMENTS, the pane, uploads, release) is Temp/browse/drive-comic.cjs.
 *   npx tsc app/components/comic/ComicHome.tsx app/components/comic/ComicChapter.tsx app/components/comic/ComicStudio.tsx app/components/comic/ComicLoreLinks.tsx app/components/comic/ComicFollowKey.tsx --rootDir app --outDir Temp/comic-render --module commonjs --target es2020 --moduleResolution node --jsx react-jsx --skipLibCheck --esModuleInterop
 *   node Temp/check-comic-render.cjs
 */
const assert = require('node:assert/strict');
const path = require('node:path');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const OUT = path.join(__dirname, 'comic-render');
const el = React.createElement;

function stub(file, exports) {
  const resolved = require.resolve(file);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: { __esModule: true, ...exports } };
}

// No fake window: next/image's code takes one for a browser. The screens' storage reads are effects or server snapshots.

// The comic's data: two volumes' worth of the mock seed, one chapter half released.
const page = (id, chapterId, position, released) => ({
  id,
  chapterId,
  position,
  isSpread: false,
  width: 3000,
  height: 4500,
  readingWidth: 2000,
  readingHeight: 3000,
  version: 1,
  hasCopies: true,
  words: '',
  releasedAt: released ? '2026-11-20T00:00:00Z' : null,
});
const everything = {
  volumes: [{ id: 'v1', number: 1, title: 'THE FIRST VOLUME' }],
  chapters: [
    { id: 'c1', volumeId: 'v1', number: 1, title: 'A TEST CHAPTER', coverPageId: null },
    { id: 'c2', volumeId: 'v1', number: 2, title: 'ANOTHER', coverPageId: null },
  ],
  pages: [page('p1', 'c1', 0, true), page('p2', 'c1', 1, true), page('p3', 'c2', 0, true), page('p4', 'c2', 1, false)],
};
const released = { ...everything, pages: everything.pages.filter((p) => p.releasedAt !== null) };

let comicState = { contents: released, error: null, admin: false, reload: async () => undefined };
let me = null;
stub(path.join(OUT, 'lib/comic/use-comic.js'), { useComic: () => comicState });
stub(path.join(OUT, 'components/AuthProvider.js'), { useAuth: () => ({ user: me === null ? null : { id: me }, status: me === null ? 'anonymous' : 'signed-in' }) });
stub(path.join(OUT, 'components/ForumProvider.js'), { useForum: () => ({ commentCountForAnchor: () => 0 }) });
let following = false;
stub(path.join(OUT, 'lib/notifications/notify-settings-store.js'), {
  useNotifySettings: () => ({ ready: true, prefs: { comic: following } }),
  setNotifySwitch: async () => undefined,
});
stub(require.resolve('next/navigation'), {
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace() {}, push() {} }),
  usePathname: () => '/comic',
});

const ComicHome = require('./comic-render/components/comic/ComicHome.js').default;
const ComicChapter = require('./comic-render/components/comic/ComicChapter.js').default;
const ComicStudio = require('./comic-render/components/comic/ComicStudio.js').default;
const ComicLoreLinks = require('./comic-render/components/comic/ComicLoreLinks.js').default;
const ComicFollowKey = require('./comic-render/components/comic/ComicFollowKey.js').default;
const draw = (element) => renderToStaticMarkup(element).replace(/<!-- -->/g, '');
const count = (html, text) => html.split(text).length - 1;

// ---------- the contents ----------
let html = draw(el(ComicHome));
assert.ok(html.includes('VOLUME 1: THE FIRST VOLUME'), 'a volume is a title line');
assert.ok(html.includes('CHAPTER 1') && html.includes('CHAPTER 2'), 'its chapters are listed');
assert.ok(html.includes('href="/comic/2"'), 'each chapter links to its column');
assert.ok(!html.includes('[ STUDIO ]'), 'a visitor has no STUDIO key');
assert.ok(!html.includes('[ FOLLOW ]'), 'a visitor has no FOLLOW key (the guest banner has the one LOG IN)');
assert.ok(!html.includes('NOT RELEASED'), 'a visitor sees no queue marks');

me = 'someone';
assert.ok(draw(el(ComicHome)).includes('[ FOLLOW ]'), 'a signed-in reader gets FOLLOW');
following = true;
assert.ok(draw(el(ComicFollowKey)).includes('[ ✓ FOLLOWING ]'), 'FOLLOWING once on');
assert.ok(draw(el(ComicFollowKey)).includes('aria-pressed="true"'), 'and it says so to a screen reader');
following = false;

comicState = { ...comicState, contents: everything, admin: true };
me = 'debaser-site';
html = draw(el(ComicHome));
assert.ok(html.includes('[ STUDIO ]'), 'the house account gets STUDIO');

comicState = { ...comicState, contents: { volumes: [], chapters: [], pages: [] }, admin: false };
assert.ok(draw(el(ComicHome)).includes('NOTHING YET.'), 'an empty comic says so in one line');

// ---------- a chapter ----------
comicState = { ...comicState, contents: released, admin: false };
me = null;
html = draw(el(ComicChapter, { chapterNumber: 1, pageNumber: null }));
assert.equal(count(html, 'data-page-number='), 2, 'a chapter is a column of its pages');
assert.ok(html.includes('id="p1"') && html.includes('id="p2"'), 'each page can be scrolled to');
assert.ok(html.includes('src="/api/comic/page/p1/reading?v=1"'), 'pages come from the file route, never storage');
assert.ok(html.includes('aspect-ratio:2000 / 3000'), 'each page holds its shape before it loads');
assert.ok(html.includes('[ NEXT CHAPTER ]'), 'the next chapter at the foot');
assert.ok(html.includes('aria-pressed="false"') && html.includes('[ COMMENTS ]'), 'COMMENTS starts off');
assert.ok(!html.includes('comic-panel'), 'no panels drawn until COMMENTS is on');
html = draw(el(ComicChapter, { chapterNumber: 2, pageNumber: null }));
assert.ok(html.includes('THAT&#x27;S ALL FOR NOW.'), 'the last chapter ends with THAT\'S ALL FOR NOW.');
assert.ok(draw(el(ComicChapter, { chapterNumber: 9, pageNumber: null })).includes('THIS CHAPTER ISN&#x27;T OUT YET.'), 'a chapter not out says so');

comicState = { ...comicState, contents: everything, admin: true };
html = draw(el(ComicChapter, { chapterNumber: 2, pageNumber: null }));
assert.equal(count(html, 'PREVIEW: NOT RELEASED'), 1, 'the house account previews the unreleased page');

// ---------- the studio ----------
comicState = { ...comicState, contents: everything, admin: false };
assert.ok(draw(el(ComicStudio)).includes('ONLY THE HOUSE ACCOUNT OPENS THE STUDIO.'), 'the studio refuses anyone else');
comicState = { ...comicState, contents: everything, admin: true };
html = draw(el(ComicStudio));
for (const tab of ['[ PAGES ]', '[ PANELS ]', '[ LORE ]', '[ RELEASE ]']) assert.ok(html.includes(tab), `the studio has ${tab}`);
assert.ok(html.includes('CONTENTS') && html.includes('[ + VOLUME ]') && html.includes('[ + CHAPTER ]'), 'PAGES holds the contents');
assert.ok(html.includes('[ ADD PAGES ]') && html.includes('DROP PAGES HERE'), 'pages are dropped or picked');
assert.equal(count(html, 'QUEUED'), 0, "chapter 1's pages are all out");

// The other tabs, drawn as the studio draws them.
const StudioRelease = require('./comic-render/components/comic/StudioRelease.js').default;
html = draw(el(StudioRelease, { contents: everything, reload: async () => undefined }));
assert.ok(html.includes('CH 2 · P 2'), 'the queue lists the unreleased page by its place');
assert.equal(count(html, 'type="checkbox"'), 1, 'only queued pages can be ticked');
assert.ok(/<button[^>]*disabled=""[^>]*>\[ RELEASE \]/.test(html), 'RELEASE waits for a tick');
const StudioPanels = require('./comic-render/components/comic/StudioPanels.js').default;
html = draw(el(StudioPanels, { contents: everything, chapter: everything.chapters[0], onChapter() {}, pageId: null, onPage() {} }));
assert.ok(html.includes('[ P 1 ]') && html.includes('[ SAVE ]') && html.includes('[ + WHOLE PAGE ]'), 'PANELS picks a page and edits its boxes');
const StudioLore = require('./comic-render/components/comic/StudioLore.js').default;
html = draw(el(StudioLore, { contents: everything, chapter: everything.chapters[0], onChapter() {}, pageId: null, onPage() {} }));
assert.ok(html.includes('PICK A PANEL.') && html.includes('CHARACTERS'), 'LORE tags panels and marks characters');

// ---------- the lore page's comic parts: nothing until the read arrives ----------
assert.equal(draw(el(ComicLoreLinks, { slug: 'the-glass-corridor', part: 'appearances' })), '', 'APPEARS IN shows nothing before it knows');

console.log('check-comic-render: ok');
