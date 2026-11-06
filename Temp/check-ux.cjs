/*
 * Scratch check for what this site owes anybody using it (run from the root):
 *   npx tsc app/lib/ui/controls.ts --outDir Temp/ux-out --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop --strict
 *   npx tsc app/components/ProjectSectionNav.tsx app/components/StartMenu.tsx --outDir Temp/ux-render --module commonjs --target es2020 --moduleResolution node --jsx react-jsx --skipLibCheck --esModuleInterop
 *   node Temp/check-ux.cjs
 *
 * A usability pass has one honest deliverable: the properties that must not drift back. What a
 * *person* meets - names on fields, contrast, the size of the small print, tap targets in the served
 * markup - is measured against the built site by Temp/qa-audit.cjs, which needs a capture from
 * `next start`. This is the same set of promises asked where the source and a static render can hold
 * them, so the ordinary suite catches a regression without a server:
 *
 *   1. every field shows where the keyboard is;
 *   2. the window refuses selection and the page panel allows it, because this archive is writing
 *      somebody may want to quote;
 *   3. the taskbar is first in the document and last on screen, so the site's own navigation is one
 *      press away rather than one page of tabbing;
 *   4. the phone's navigation - the Start menu and the project strip - is thumb-sized;
 *   5. a click target that is not a button or a link is hidden from the accessibility tree, so
 *      nothing on this site is mouse-only;
 *   6. a pop-up takes focus as it opens, rather than leaving it in the page it is covering;
 *   7. the Start button says what it opens, since on a phone it holds the whole site.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

// One input file, so `tsc` puts it straight in the output folder (see the header).
const { FIELD, FIELD_TIGHT, SHELF_CHIP } = require('./ux-out/controls.js');
const ProjectSectionNav = require('./ux-render/components/ProjectSectionNav.js').default;
const StartMenu = require('./ux-render/components/StartMenu.js').default;

const read = (file) => fs.readFileSync(file, 'utf8');

/**
 * The source with its commentary taken off: these assertions are about code, and prose that mentions
 * a class name must not be able to satisfy one of them (see Temp/qa-audit.cjs, where exactly that
 * produced two findings against fixes that were already in).
 */
const codeOf = (file) => read(file).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const element = React.createElement;

// 1. A field has to show where the keyboard is: the browser's outline was cancelled, so the ring is
//    this site's own - two pixels of navy, dotted, the way a control panel drew one.
const RING = /focus:outline-2 focus:outline-offset-1 focus:outline-dotted focus:outline-bubble/;

for (const [name, value] of [
  ['FIELD', FIELD],
  ['FIELD_TIGHT', FIELD_TIGHT],
]) {
  assert.match(value, RING, `${name} draws a focus ring`);
}

// 2. The window is a window; the page inside it is prose. One class each, and both have to be there.
const window = codeOf('app/components/SiteWindow.tsx');
assert.match(window, /main className=[{`"]*desktop-tile[^"`]*select-none/, 'the window itself refuses selection');
assert.match(window, /data-scroll-pane="page"\s+className=[^>]*select-text/, 'and the reading panel turns it back on for what it holds');

// 3. The page tabs are the window's header: written above the page, so the keyboard meets them
//    first, while the tray is pulled to the foot with `order-last`.
assert.ok(
  window.indexOf('<SiteNav') < window.indexOf('{children}'),
  'the tabs are written before the page, so the keyboard reaches them first',
);
assert.match(
  codeOf('app/components/Taskbar.tsx'),
  /relative order-last/,
  'and the tray is drawn at the foot of the window with `order-last`',
);

// 4. On a phone the Start menu and the project strip *are* the navigation, so their rows are 44px.
assert.match(codeOf('app/components/StartMenu.tsx'), /max-sm:min-h-tap/, 'the menu rows ask for a thumb`s height');

// One key, one place. On a phone there is now exactly one navigation surface - the account menu
// behind the picture - so every key appears there and nowhere else: the header band is wide-screen
// chrome and so is the Start plate, which is the whole of the mobile consolidation rule.
const { NAV_ITEMS: SITE_KEYS } = require('./ux-render/components/SiteNav.js');
assert.deepEqual(
  SITE_KEYS.map((item) => item.key),
  // 2026-10-24 (SPEC-media-catalogue.md): MEDIA joined the band after FORUM.
  // 2026-11-04: ARCHIVE (`web`) and CYTUBE joined after MEDIA.
  ['home', 'forum', 'media', 'web', 'cytube', 'users', 'comms', 'account'],
  'the keys are the ones the window carries, in order',
);
assert.equal(
  new Set(SITE_KEYS.map((item) => item.href)).size,
  SITE_KEYS.length,
  'and no page is listed twice',
);
for (const item of SITE_KEYS) {
  assert.ok(typeof item.mark === 'string' && item.mark.length > 0, `${item.key} wears a mark`);
  assert.ok(typeof item.label === 'string' && item.label.length > 0, `${item.key} says what it is called`);
}
const startMenu = renderToStaticMarkup(element(StartMenu, { onDismiss: () => undefined }));
assert.equal(
  (startMenu.match(/class="hidden lg:flex w-full/g) ?? []).length,
  0,
  'the menu lists every key on every screen, because the band and the plate are wide-screen only',
);

// The shelf chip is one class used in two places - the strip across a page and the landing page's
// list - so it is shared rather than copied, and it is the phone-sized one.
assert.match(SHELF_CHIP, /max-sm:min-h-tap/, 'the shelf chip asks for a thumb`s height');
assert.match(codeOf('app/components/ProjectSectionNav.tsx'), /className={SHELF_CHIP}/, 'the strip uses it');
// The landing page is the board now: an unauthenticated visitor goes straight to the feed, so the
// old map of the site is not there to carry a chip. What the rule became is worth asserting instead.
assert.match(codeOf('app/page.tsx'), /redirect\('\/forum'\)/, 'and the landing page hands over to the board');

const strip = renderToStaticMarkup(element(ProjectSectionNav, { current: 'lore' }));
assert.match(strip, /max-sm:min-h-tap/, 'which is what the strip renders');
assert.match(strip, /\[ LORE \]/, 'and it still marks the shelf the page is on');
assert.match(strip, /\[ &lt; DEBASER PROJECT \]/, 'and still offers the way back up');

const menu = renderToStaticMarkup(element(StartMenu, { onDismiss: () => undefined }));
assert.match(menu, /<nav aria-label="Site menu"/, 'the menu is a labelled nav, and says which');
assert.match(menu, /max-sm:min-h-tap/, 'with thumb-sized rows in the markup, not only in the class list');

// 5. Mouse-only is a bug: a click target that is not a button or a link has to be hidden from the
//    accessibility tree. The two that exist are the invisible backdrops that close a pop-up on an
//    outside click, and the same actions sit on real buttons beside them.
//
//    Reading a JSX tag needs care: `onClick={() => ...}` contains a `>`, so a plain `[^>]*` stops at
//    the arrow and never sees the attributes after it. The tag ends at the first `>` that does not
//    follow an `=`, which is what this walks to.
function openingTags(source, name) {
  const pattern = new RegExp(`<${name}\\b`, 'g');
  const tags = [];
  let match = pattern.exec(source);

  while (match !== null) {
    let end = match.index + match[0].length;

    while (end < source.length && !(source[end] === '>' && source[end - 1] !== '=')) end += 1;

    tags.push(source.slice(match.index, end + 1));
    match = pattern.exec(source);
  }

  return tags;
}

for (const file of fs.readdirSync('app/components')) {
  if (!file.endsWith('.tsx')) continue;

  const source = read(`app/components/${file}`);

  for (const tag of [...openingTags(source, 'div'), ...openingTags(source, 'span')]) {
    if (!tag.includes('onClick=')) continue;

    // (2026-11-04, SPEC-forum-search.md) One more shape is not mouse-only: the search box's frame, whose whole job is
    // putting focus in the field inside it (ForumSearchBox.tsx). A keyboard reaches that field by Tab, so nothing is lost,
    // and aria-hidden here would hide the field and its pills from a screen reader. Held tightly: the handler can do
    // nothing else, and the ref has to land on a named input or textarea that is really inside this element.
    const handsFocus = tag.match(/onClick=\{\(\) => (\w+)\.current\?\.focus\(\)\}/);
    if (handsFocus !== null) {
      const body = source.slice(source.indexOf(tag) + tag.length);
      const fieldAt = body.indexOf(`ref={${handsFocus[1]}}`);
      assert.ok(fieldAt > 0, `${file}: a frame that hands focus names a field`);
      const opened = (body.slice(0, fieldAt).match(/<(div|span)\b/g) ?? []).length;
      const closed = (body.slice(0, fieldAt).match(/<\/(div|span)>/g) ?? []).length;
      assert.ok(closed <= opened, `${file}: the field a frame hands focus to is inside that frame`);
      const fieldStart = body.lastIndexOf('<', fieldAt);
      const fieldTag = body.slice(fieldStart, body.indexOf('/>', fieldAt));
      assert.match(fieldTag, /^<(input|textarea)\b/, `${file}: a frame only hands focus to a real field`);
      assert.match(fieldTag, /aria-label=/, `${file}: and that field has a name of its own`);
      continue;
    }

    assert.match(
      tag,
      /aria-hidden/,
      `${file}: a click target that is not a control is hidden from assistive tech`,
    );
  }
}

// 6. A dialogue nobody is standing in lets Tab walk into the page behind it.
const popout = codeOf('app/components/PopoutWindow.tsx');
assert.match(popout, /windowRef\.current\?\.focus\(\)/, 'a pop-up takes focus as it opens');
assert.match(popout, /tabIndex=\{-1\}/, 'because the window itself is focusable');
assert.match(popout, /aria-label="Close window"/, 'and the close control has a name of its own');

// 7. Every destination on a phone is behind one button, so that button has to say what it opens -
//    and the name it is read with still starts with the word on the plate.
const taskbar = codeOf('app/components/Taskbar.tsx');
assert.match(taskbar, /aria-label="START/, 'the Start button is read with the word on its plate');
// (2026-10-25, SPEC-less-text.md) The tip `The site menu: every page, and the debaser project's shelves` -> `Menu`.
assert.match(taskbar, /title="Menu"/, 'and describes itself to a pointer');
assert.doesNotMatch(taskbar, /title="The site menu/, 'in a word');
assert.match(
  codeOf('app/components/SiteNav.tsx'),
  // (2026-11-04, Luke 2026-10-30) The keys became named pages, and the label moved with them. What is held is that it has
  // a name of its own, which is not the Start menu's.
  /<nav\s+aria-label="(?!Site menu")[^"]+"/,
  'the page tabs are a labelled nav of their own (see ./SiteNav.tsx, which draws them)',
);

console.log('ux checks passed');
console.log('  keyboard  : the page tabs come first in the document, the tray last on screen');
console.log('  focus     : fields draw a dotted navy ring; pop-ups take focus as they open');
console.log('  reading   : the page panel can be selected from, the chrome cannot');
console.log('  phones    : the Start menu, the project strip and the plates are 44px');
console.log('  names     : the Start button says what it opens, and each menu says which it is');

