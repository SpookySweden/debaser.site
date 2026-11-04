/**
 * The collapsed row's band, and the wire it carries - held where they can fail.
 *
 * Three rules. The first is a defect that was measured on the deployed board, the second is a defect
 * the same work uncovered, and the third is the readability half of the site's motion switch:
 *
 *   1. **A collapsed row has no reveal left to dismiss.** The band used to fill itself on hover:
 *      `PostHoverPreview` - `PostRowDetails` now - revealed with `group-has-[:focus-visible]:flex`,
 *      and before that with `group-focus-within:flex`, which matches for *any* focus: a real click on
 *      a `<summary>` leaves `document.activeElement` on it, `:focus` true and `:focus-visible` false,
 *      so the click that collapsed a post left the panel lying over the rows below. Measured on the
 *      deployed board with the pointer already off the list: `:focus-within` true, `:focus-visible`
 *      false, panel `display: flex`. The fix at the time was `:focus-visible`; the shape now is
 *      better than a fix - **the band is filled in both states**, hover is only the row's highlight,
 *      and there is nothing to reveal, nothing to dismiss and nothing that can be left open. This
 *      check holds the structure: no hover, no focus, no `hidden`.
 *
 *   2. **The collapsed row carries its wire at every width.** The band lives in the reserved right
 *      column, which is `hidden sm:flex`; below `sm` nothing can reach it, and a pointed-at 600px
 *      window measured `reel drawn 0/5`. The narrow board draws the same strip
 *      (`./PostReplyReel.tsx`) under the credit strip, where it needs no pointer at all.
 *
 *   3. **A still wire must be readable.** The site stops every animation under
 *      `prefers-reduced-motion: reduce`, which left a clipped 1528px track in a 342px band that could
 *      be neither read past its first reply nor scrolled, because a wire is not a control. The
 *      duplicate copy goes and the rows wrap in that one setting - and that lives in `NewsCrawl` now
 *      rather than in the strip, because the strip *is* the board's wire (`buildReplyNews`), so the
 *      newswire at the top of the board and a profile's feed get it too.
 *
 * The behaviour behind rules 1 and 2 was read out of a real Chrome, not out of these files:
 * `Temp/probe-focus-visibility.cjs` and `Temp/probe-reel-widths.cjs` are the instruments, and the
 * numbers quoted above are what they printed. What this check holds is the *source* property those
 * readings rest on, so a later edit cannot quietly take the behaviour away - which is exactly how the
 * `group-focus-within` version got here and stayed green.
 *
 *   npx tsc app/lib/forum/news-feed.ts --outDir Temp/wire-out --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop
 *   node Temp/check-post-reel.cjs
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { buildReplyNews, NEWS_REPLY_LIMIT } = require('./wire-out/forum/news-feed.js');

const read = (file) => fs.readFileSync(path.join(...file.split('/')), 'utf8');

const band = read('app/components/PostRowDetails.tsx');
const strip = read('app/components/PostReplyReel.tsx');
const crawl = read('app/components/NewsCrawl.tsx');
const commentRow = read('app/components/CommentRow.tsx');
const card = read('app/components/ForumThreadCard.tsx');
// (2026-10-23, docs/theming.md) globals.css imports app/theme/tokens.css, where the motion tokens now are.
const css = read('app/globals.css') + read('app/theme/tokens.css');
// The site's rules moved out of CLAUDE.md on 2026-10-22; the reveal rule now lives in the frontend rules.
const agents = read('.claude/rules/frontend.md');

console.log('collapsed-row band');

// 1. There is no reveal in a collapsed row, and nothing about one arrives when it is pointed at.
assert.doesNotMatch(band, /group-hover|group-focus-within|group-has-/, 'the band answers no pointer and no focus');
assert.match(band, /\babsolute inset-0\b/, 'it is out of the row`s flow, so it can never push the list');
assert.match(band, /pointer-events-none/, 'and it passes the pointer through to the row it sits in');
assert.match(band, /overflow-hidden/, 'clipped by the row`s own height: the band does not make the row');
assert.match(card, /\{isOpen \? null : \(\r?\n\s*<PostRowDetails/, 'the card draws it whenever the row is collapsed');
assert.match(card, /relative hidden w-2\/5 min-w-0 shrink-0 sm:flex/, 'in a column held open in both states');
assert.doesNotMatch(card, /PostHoverPreview/, 'and the hover panel is gone, not merely hidden');
// `pointed`, not `sun`: the row's inks are the field's, and White on Daffodil was 1.19:1 in the dark theme.
assert.match(card, /hover:bg-pointed/, 'pointing at a row is the highlight on the summary, and nothing else');

// 2. What the band carries, and where the wire goes at every width.
assert.match(band, /\[mask-image:linear-gradient\(to_bottom/, 'the words lose their opacity into the bottom of the box');
// (2026-10-23, SPEC-efficiency.md) `[ EXPAND ]` is cut: the row's `[+]` opens the post.
assert.doesNotMatch(
  band.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, ''),
  /\[ EXPAND \]/,
  'and no second key says where the rest of the post is',
);
assert.match(strip, /export default function PostReplyReel/, 'the wire is its own component');
assert.match(strip, /buildReplyNews/, 'built from the board`s own wire rows, not a second row shape');
assert.match(strip, /<NewsCrawl\b/, 'and drawn by the one crawl the site has');
assert.match(card, /<PostReplyReel\b[^/]*\bsm:hidden/, 'and the collapsed row draws it below `sm`, always');
assert.doesNotMatch(card, /className="crawl/, 'the strip is not written out a second time on the card');

// The rows themselves, which is where the wire's order and its clipping live.
const comments = [
  {
    id: 'c-old',
    threadId: 't1',
    body: 'first pass',
    author: { id: 'u1', displayName: 'one' },
    createdAt: '2026-09-21T10:00:00.000Z',
    tags: [],
  },
  {
    id: 'c-new',
    threadId: 't1',
    body: 'y'.repeat(300),
    author: { id: 'u2', displayName: 'two' },
    createdAt: '2026-09-22T10:00:00.000Z',
    tags: [],
  },
];

const rows = buildReplyNews(comments);
assert.equal(rows.length, 2, 'every reply becomes a row');
assert.equal(rows[0].id, 'news-reply-c-new', 'newest first, like every wire');
assert.equal(rows[0].tag, 'REPLY', 'stamped the way the newswire stamps a reply');
assert.equal(rows[0].author.displayName, 'two', 'with the account that wrote it');
assert.ok(rows[0].text.length <= 113 && rows[0].text.endsWith('...'), 'clipped to one line`s worth');
assert.equal(rows[0].createdAt, '2026-09-22T10:00:00.000Z', 'and the stamp of when it was filed');
assert.equal(rows[0].href, undefined, 'no link: a wire beside the row is not a place to press');
assert.equal(buildReplyNews(comments, 1).length, 1, 'a thread longer than the strip holds is clipped');
assert.ok(buildReplyNews(comments).length <= NEWS_REPLY_LIMIT, 'and the ceiling is the one the strip declares');
assert.deepEqual(buildReplyNews([]), [], 'a post nobody has answered draws no wire');

// 3. The wire's two states: the seam when it moves, and legible words when it does not.
assert.match(crawl, /motion-reduce:w-full/, 'a still wire takes the width it has');
assert.match(crawl, /motion-reduce:flex-wrap/, 'and wraps instead of clipping');
assert.match(crawl, /motion-reduce:hidden/, 'the duplicate copy goes - the words must not print twice');
assert.match(commentRow, /motion-reduce:whitespace-normal/, 'and a long reply may itself wrap');
assert.match(commentRow, /motion-reduce:flex-wrap/, 'inside its own row, not only between rows');
// (2026-10-23) `.crawl` asks for its token now (`animation: var(--animate-crawl)`), and the token is the crawl.
assert.match(css, /\.crawl \{\s*animation: var\(--animate-crawl\)/, 'the wire still crawls at all');
assert.match(css, /--animate-crawl:\s*crawl /, 'and its token is the crawl keyframe');
assert.match(
  css,
  /@media \(prefers-reduced-motion: reduce\) \{\s*\.crawl \{\s*animation: none;/,
  'and the one motion switch still stops it - the premise of the wrapped, still state',
);

// The rules are the site's, so the ones learned here are written down in .claude/rules/frontend.md.
assert.match(agents, /:focus-visible/, 'frontend.md keeps the rule that a reveal answers a keyboard focus, never `:focus-within`');
assert.match(agents, /in both states/, 'and the rule that the band is carried whether or not a pointer is on the row');

// Printed last, on purpose: the runner reports the first line of stdout.
console.log('  ok         the band arrives in both states, and the wire it carries is drawn and legible at every width');
