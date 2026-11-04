/*
 * Scratch check of the markup the board actually renders (run from the root):
 *   npx tsc app/components/PostAuthorRow.tsx app/components/AnchorLink.tsx --outDir Temp/render-check --module commonjs --target es2020 --moduleResolution node --jsx react-jsx --skipLibCheck --esModuleInterop
 * (2026-11-04) The next steps compile all it requires: it had been passing on what earlier runs left in Temp/.
 *   npx tsc app/components/PostAuthorRow.tsx app/components/AnchorLink.tsx app/components/AuthProvider.tsx app/components/PresenceProvider.tsx app/lib/concepts/sheets.ts --rootDir app --outDir Temp/render-check --module commonjs --target es2020 --moduleResolution node --jsx react-jsx --skipLibCheck --esModuleInterop
 *   npx tsc app/lib/forum/site-author.ts --rootDir app/lib --outDir Temp/layout-check --module commonjs --target es2020 --moduleResolution node --jsx react-jsx --skipLibCheck --esModuleInterop
 *   node Temp/check-render.cjs
 *
 * Proves the two fixes at the DOM level:
 *   1. a post owned by a concept sheet is signed "debaser.site", the house account
 *      behind the archive's own byline, and names no commenter;
 *   2. the link-back preview lives inside the link's own hover scope, and is not
 *      drawn at all when the card already shows that drawing.
 */
const assert = require('node:assert/strict');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const PostAuthorRow = require('./render-check/components/PostAuthorRow.js').default;
const AnchorLink = require('./render-check/components/AnchorLink.js').default;
const AuthProvider = require('./render-check/components/AuthProvider.js').default;
const PresenceProvider = require('./render-check/components/PresenceProvider.js').default;
const { SITE_AUTHOR, SITE_AUTHOR_PICTURE } = require('./layout-check/forum/site-author.js');
const { CONCEPT_SHEETS } = require('./render-check/lib/concepts/sheets.js');

const element = React.createElement;
const sheet = CONCEPT_SHEETS[0];

/** PostAuthorRow draws the presence lamp, so it needs the providers around it. */
const withProviders = (child) =>
  renderToStaticMarkup(element(AuthProvider, null, element(PresenceProvider, null, child)));

// 1. Item-owned post header: house name + default pfp, no commenter, no profile link.
const siteRow = withProviders(
  element(PostAuthorRow, {
    author: SITE_AUTHOR,
    avatar: 'shown',
    avatarSize: 56,
    picture: SITE_AUTHOR_PICTURE,
  }),
);

assert.match(siteRow, /debaser\.site/, 'header signs the site');
assert.doesNotMatch(siteRow, /sweden/, 'no commenter name in the header');
assert.match(siteRow, /href="\/profile\/debaser-site"/, 'the byline opens the house account profile');
assert.match(siteRow, /width:56px;height:56px/, 'default pfp keeps the avatar size');
// The house picture is a named path the row points at (SITE_AUTHOR_PICTURE), so while the drawing is
// still unmade the browser is the one that says so - the same treatment every other slot gets.
assert.match(siteRow, /avatar-default\.png/, 'the default pfp names the file it is waiting for');
assert.match(siteRow, /border border-ink bg-paper/, 'in the plain avatar frame');

// 2. An ordinary post keeps its poster's name and profile link.
const posterRow = withProviders(
  element(PostAuthorRow, {
    author: { id: 'user-sweden', displayName: 'sweden' },
    avatar: 'shown',
    avatarSize: 56,
    country: 'SE',
  }),
);

assert.match(posterRow, /sweden/, 'a real post still names its poster');
assert.match(posterRow, /href="\/profile\/user-sweden"/, 'poster links to their profile');
// The country, drawn *and* named: the flag slot asks for the hand-drawn file by the code's own path,
// and the name beside it means the byline reads without knowing a flag by sight.
assert.match(posterRow, /%2Fassets%2Fflags%2Fse\.png/, 'the flag slot asks for /assets/flags/se.png');
assert.match(posterRow, /SWEDEN/, 'and the byline names the country in words beside it');
// A person with no drawing of their own wears the same anonymous slot a guest does - the slot is the
// site's "not chosen yet", not a house picture - so the row's *one* image tag is the flag, and the
// avatar draws no tag for a file that is absent. (Its title names the missing file; a src would be a
// request for something nobody has drawn.)
assert.match(posterRow, /sprite-slot/, 'a poster with no picture wears the anonymous slot');
const rowImages = posterRow.match(/<img[^>]*>/g) ?? [];
assert.equal(rowImages.length, 1, `the row carries exactly one image tag (got ${rowImages.length})`);
assert.match(rowImages[0], /flags%2Fse\.png/, 'and it is the flag, not the avatar file');

// 2b. A byline with no country picked carries no flag at all - not an empty slot beside the name.
const noCountryRow = withProviders(
  element(PostAuthorRow, { author: { id: 'user-nordic', displayName: 'nordic' }, avatar: 'hidden' }),
);
assert.doesNotMatch(noCountryRow, /assets\/flags/, 'no country means no flag markup at all');
assert.doesNotMatch(noCountryRow, /sprite-slot/, 'and no empty slot where the flag would be');

// 3. Anchor link with the preview off: no popup markup at all.
const bareLink = renderToStaticMarkup(element(AnchorLink, { anchor: sheet.anchor, preview: 'none' }));
assert.doesNotMatch(bareLink, /group-hover/, 'no hover popup is rendered');
assert.doesNotMatch(bareLink, /PREVIEW \/\//, 'no preview picture is rendered');
assert.match(bareLink, /SHEET 01 \/\/ FIGURE STUDY/, 'the link itself stays');

// 4. Anchor link with the preview on: the popup exists, scoped to its own group.
const hoverLink = renderToStaticMarkup(element(AnchorLink, { anchor: sheet.anchor }));
assert.match(hoverLink, /group\/link/, 'the link owns its hover scope');
assert.match(hoverLink, /group-hover\/link:block/, 'the popup follows the link, not the card');
assert.match(hoverLink, /PREVIEW \/\/ SHEET 01 \/\/ FIGURE STUDY/);

console.log('render checks passed');
console.log('  site header :', siteRow.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
console.log('  poster row  :', posterRow.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
