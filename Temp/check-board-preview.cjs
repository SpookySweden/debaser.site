/*
 * Scratch check for the tag swatches and the collapsed row's band:
 *   npx tsc app/lib/forum/tags.ts --outDir Temp/check-out --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop
 *   npx tsc app/components/PostRowDetails.tsx app/components/TagBadge.tsx --outDir Temp/render-out --module commonjs --target es2020 --moduleResolution node --jsx react-jsx --skipLibCheck --esModuleInterop
 *   node Temp/check-board-preview.cjs
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const TagBadge = require('./render-out/components/TagBadge.js').default;
const PostRowDetails = require('./render-out/components/PostRowDetails.js').default;
const AuthProvider = require('./render-out/components/AuthProvider.js').default;
const PresenceProvider = require('./render-out/components/PresenceProvider.js').default;
const { TAG_MARK_PALETTE, tagColour } = require('./check-out/forum/tag-vocabulary.js');
const { MARK_LIGHTNESS, MARK_SATURATION, contrastRatio, hexToHsl, markColour } = require('./check-out/ui/colour.js');
const { mergeTags } = require('./check-out/forum/tags.js');

const element = React.createElement;
const withProviders = (child) =>
  renderToStaticMarkup(element(AuthProvider, null, element(PresenceProvider, null, child)));

const background = (html) => /background-color:\s*([^;"]+)/.exec(html)?.[1];

// 1. A theme tag and a picked tag with the same label are the same colour now - and that colour is
//    the *key* on a neutral chip rather than the chip's own fill, so a board of tags reads as one
//    board instead of a bag of sweets.
const derived = { id: 'cat-design', kind: 'category', label: 'DESIGN' };
const picked = { id: 'user-design', kind: 'user', label: 'DESIGN' };
const chosen = { id: 'user-design', kind: 'user', label: 'DESIGN', colour: '#ffb3ba' };
const chip = (tag) => renderToStaticMarkup(element(TagBadge, { tag }));

assert.equal(tagColour('DESIGN'), tagColour('design'), 'a label keeps its colour through any spelling');
assert.ok(TAG_MARK_PALETTE.includes(tagColour('DESIGN')), 'and it is one of the palette');
assert.equal(background(chip(derived)), tagColour('DESIGN'), 'the theme tag wears its key');
assert.equal(background(chip(derived)), background(chip(picked)), 'post badge === picker badge');
assert.match(chip(derived), /bg-bubble-pale/, 'the chip itself is the quiet magenta of the palette');
assert.doesNotMatch(chip(derived), /text-white/, 'and its label is readable ink');
assert.equal(
  background(chip(chosen)),
  markColour('#ffb3ba'),
  'a colour chosen for the label still wins, at the weight a key wears',
);
assert.notEqual(markColour('#ffb3ba'), '#ffb3ba', 'which is not the weight it arrived in: a pastel is too pale to mark with');
assert.equal(background(chip({ id: 'content-spoiler', kind: 'content', label: 'SPOILER' })), markColour(tagColour('SPOILER')));
assert.equal(
  background(chip({ id: 'source-x', kind: 'source', label: 'BOARD' })),
  undefined,
  'a retired housekeeping tag stays grey, and carries no key',
);

// The palette's own rule, which is what "sleeker" means here: sixteen hues at *one* weight - so two
// tags a step apart are equally strong - and every one of them visible on the chip it sits on.
assert.equal(TAG_MARK_PALETTE.length, 16, 'sixteen swatches');
assert.equal(new Set(TAG_MARK_PALETTE).size, 16, 'every one of them distinct');

for (const colour of TAG_MARK_PALETTE) {
  const hsl = hexToHsl(colour);

  assert.ok(hsl !== null, `${colour} is a hex colour`);
  assert.equal(Math.round(hsl.s), MARK_SATURATION, `${colour} sits at the palette's saturation`);
  assert.equal(Math.round(hsl.l), MARK_LIGHTNESS, `${colour} sits at the palette's lightness`);

  const againstChip = contrastRatio(colour, '#e8e8e8');
  assert.ok(againstChip >= 3, `${colour} is visible on the chip it sits on (${againstChip.toFixed(2)}:1)`);
}

// A mark is clamped into that same weight, whatever arrives: the old pastel set, a hand-edited hex,
// a colour nobody would have chosen. Hue is the only thing that survives untouched - which is why a
// screaming lime comes back as the palette's own green.
assert.equal(markColour('#ffffff'), markColour('#c0c0c0'), 'the two palest swatches clamp to the lightness ceiling');
assert.equal(markColour('#00ff00'), '#388a38', 'a screaming lime comes back calm');
assert.equal(Math.round(hexToHsl(markColour('#ffb3ba')).l), MARK_LIGHTNESS, 'and a pastel comes back at the palette`s weight');
assert.equal(hexToHsl(markColour('#ff0000')).h, hexToHsl('#ff0000').h, 'with its hue kept');
assert.equal(markColour('not-a-colour'), 'not-a-colour', 'and something unreadable is passed straight through');

// A colour remembered for a label reaches theme tags written from now on.
const merged = mergeTags([], [derived], { design: '#ffb3ba' });
assert.equal(merged[0].colour, '#ffb3ba');
assert.equal(mergeTags([], [derived], {})[0].colour, undefined, 'and nothing is invented for it');

// 2. The collapsed row's band: as much of the post as the row's own height allows, faded into an
// `[ EXPAND ]`, with the thread's replies going past under it as the site's newswire rows.
//
// **It is not a reveal any more, and that is the point of the shape below.** This component was
// `PostHoverPreview`: it revealed itself on `group-hover` *and* on `group-focus-within`, and the
// second of those is the bug `Temp/check-post-reel.cjs` holds - `:focus-within` matches for any
// focus, so the click that collapsed a post left the panel lying over the rows below it. The band is
// filled in both states instead, hover is only the row's highlight, and the assertions below hold
// that rather than the old shape.
const longBody = 'x'.repeat(500);
const comments = [
  {
    id: 'c1',
    threadId: 't1',
    body: 'The hands need one more pass.',
    author: { id: 'user-sweden', displayName: 'sweden' },
    createdAt: '2026-09-21T10:00:00.000Z',
    tags: [],
  },
  {
    id: 'c2',
    threadId: 't1',
    body: 'Agreed   -   the knuckles read flat.',
    author: { id: 'user-luke', displayName: 'luke' },
    createdAt: '2026-09-21T10:05:00.000Z',
    tags: [],
  },
];

/**
 * The markup with React's comment separators taken out of it.
 *
 * `[ REPLY ]` is served as `[ <!-- -->REPLY<!-- --> ]` - React wraps a dynamic text node in comments -
 * so a plain search for the words finds nothing and reports a present feature as missing. That
 * mistake has been made twice on this project (see CLAUDE.md, "A missing grep is not an absent
 * feature"), and it is cheaper to strip the comments here than to distrust the result.
 */
const bare = (html) => html.replace(/<!--.*?-->/g, '');

const rich = withProviders(element(PostRowDetails, { body: longBody, comments }));
const richBare = bare(rich);

// The reservation is the caller's, and the band declares that it fills it - which is what lets
// `check-reveals.cjs` tell "a box somebody laid out" from "a box that appears from nothing".
assert.match(rich, /data-reveal="reserved"/, 'the band declares that it fills a space its caller reserved');
assert.doesNotMatch(rich, /group-hover|group-focus-within|group-has-/, 'and is drawn in both states: no hover, no focus');
// Out of flow, absolute inside the reserved column, so the row's height stays the left column's - the
// words are clipped by the row rather than the row by the words. In flow this panel once made a 66px
// row 187px tall the moment it was pointed at, which is what put the list under the pointer.
assert.match(rich, /\babsolute inset-0\b/, 'the band is out of the row`s flow, so the row`s height is not its business');
assert.match(rich, /pointer-events-none/, 'and it passes the pointer through to the row it sits in');
assert.match(rich, /overflow-hidden/, 'clipped by that height: this is what "as much as fits" means');
assert.match(rich, /flex-col/, 'the words above, the wire below');

// The words are handed over whole and the *box* is what limits them, so a taller row shows more of
// the same post rather than a different slice of it. What fades is the text's own opacity - a mask -
// because an overlay would have to be the colour of whatever is behind it, and behind it is a quiet
// row or a row a pointer has brightened.
assert.match(rich, /x{500}/, 'the words are handed over whole - the box is what cuts them');
assert.match(rich, /\[mask-image:linear-gradient\(to_bottom/, 'and lose their opacity into the bottom of it');
// (2026-10-23, SPEC-efficiency.md) `[ EXPAND ]` is cut: the row's own `[+]` opens the post, and a second key
// for the same press was one too many.
assert.doesNotMatch(rich, /\[ EXPAND \]/, 'with no second key for what the row`s [+] already does');
assert.doesNotMatch(rich, /THE REST WHEN EXPANDED/, 'the long-winded hint went out with the hover panel');
// The strip is the board's own wire: `buildReplyNews` rows (`app/lib/forum/news-feed.ts`) in the one
// crawl the site has, so a reply reads here exactly as it does on the newswire at the top of the board.
// (2026-10-23, SPEC-efficiency.md) The `LATEST REPLIES` heading is cut; the reel itself stays, and each row's
// `[ REPLY ]` stamp is what says it is a wire of replies.
assert.doesNotMatch(rich, /LATEST REPLIES/, 'the strip needs no heading: its rows are stamped');
assert.match(rich, /\bcrawl\b/, 'and it crawls');
assert.equal((rich.match(/<ul/g) ?? []).length, 2, 'the track holds the list twice, so the loop has no seam');
assert.match(richBare, /\[ REPLY \]/, 'each row is stamped the way the newswire stamps a reply');
assert.match(richBare, /The hands need one more pass\./, 'and carries what was said');
assert.match(richBare, /Agreed - the knuckles read flat\./, 'with the reply`s whitespace flattened for the crawl');
assert.match(richBare, /sweden/);
assert.match(richBare, /luke/);
assert.match(richBare, /2026-09-21/, 'and the stamp of when it was filed');
assert.match(rich, /aria-hidden="true"/, 'the band is decoration: the same words - and every reply - are on the card');

const quiet = withProviders(element(PostRowDetails, { body: 'short note', comments: [] }));
assert.match(quiet, /short note/);
// (2026-10-23, SPEC-efficiency.md) `[ EXPAND ]` is cut (see above).
assert.doesNotMatch(quiet, /\[ EXPAND \]/, 'no second key on a quiet row either');
assert.doesNotMatch(quiet, /crawl/, 'no replies, no crawl');

const empty = withProviders(element(PostRowDetails, { body: '', comments: [] }));
assert.doesNotMatch(empty, /<p /, 'an item-owned post with no body draws nothing but the band its caller reserved');

// The ceiling is on the DOM, not on the reading: a 20,000-character post is not painted into every
// row of the board to have three lines of it seen.
const huge = withProviders(element(PostRowDetails, { body: 'y'.repeat(2000), comments: [] }));
assert.match(huge, /y{900}\.\.\./, 'a post longer than the ceiling is cut there');

// The other half of the contract, in the caller: the box is laid out in both states, and what it
// holds is absolute inside it, so opening a post - which takes the band away - cannot move the row
// the reader just tapped, and neither can pointing at one.
const card = fs.readFileSync('app/components/ForumThreadCard.tsx', 'utf8');
assert.match(card, /relative hidden w-2\/5 min-w-0 shrink-0 sm:flex/, 'the caller reserves the right column, and is what the band hangs from');
assert.match(card, /\{isOpen \? null : \(\r?\n\s*<PostRowDetails/, 'and only its contents swap');
assert.doesNotMatch(card, /PostHoverPreview/, 'the hover panel is gone from the card, not merely hidden');
// `pointed`, not `sun`: the row's inks are the field's, and White on Daffodil was 1.19:1 in the dark theme.
assert.match(card, /hover:bg-pointed/, 'pointing at a row is the highlight on the summary, and nothing else');

console.log('board preview + swatch checks passed');
console.log('  DESIGN  : theme tag', background(chip(derived)), '=== picker tag', background(chip(picked)));
console.log('  band    : words handed over whole, clipped by the row, faded into an [ EXPAND ]');
console.log('  wire    : the post`s replies as the newswire`s own rows, two copies for a seamless loop');
