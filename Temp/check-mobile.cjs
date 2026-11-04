/**
 * The phone rules, held where they can fail.
 *
 * A visual QA pass found the shell drifting: `StartMenu`, `ProfileControl`'s menu rows and
 * `controls.ts` all had phone branches, but the *trigger* controls - the picture in the title bar, the
 * tab keys, the panel rail - did not, so a row of 18px glyphs sat directly above a careful 44px menu.
 * Nothing caught it because nothing asked.
 *
 * This asks on two fronts:
 *
 *   1. every control a phone can actually reach clears the 44px floor the project already uses
 *      (`max-sm:min-h-tap`), and
 *   2. the destinations that only the side panel carries are reachable at every width, which is what
 *      the `md:` on the panel's two shells is for.
 *
 * (2026-10-23) This header had no compile line, so `npm run checks` never rebuilt `Temp/mobile-render`
 * and the check rendered a copy of the shell compiled on 2026-09-24 - Win95 bevels and all - and passed
 * against it for a month. Found when the tap class was renamed (`min-h-11` -> `min-h-tap`) and the stale
 * copy still said the old name. The runner now compiles the five components it renders:
 *   npx tsc app/components/AuthProvider.tsx app/components/PresenceProvider.tsx app/components/CommsProvider.tsx app/components/NotificationsProvider.tsx app/components/SiteWindow.tsx --outDir Temp/mobile-render --module commonjs --target es2020 --moduleResolution node --jsx react-jsx --skipLibCheck --esModuleInterop --strict
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { AppRouterContext } = require('next/dist/shared/lib/app-router-context.shared-runtime.js');

const element = React.createElement;
const router = { push: () => undefined, replace: () => undefined, refresh: () => undefined, back: () => undefined, forward: () => undefined, prefetch: () => undefined };

const { default: AuthProvider } = require('./mobile-render/components/AuthProvider.js');
const { default: PresenceProvider } = require('./mobile-render/components/PresenceProvider.js');
const { default: CommsProvider } = require('./mobile-render/components/CommsProvider.js');
const { default: NotificationsProvider } = require('./mobile-render/components/NotificationsProvider.js');
const { default: SiteWindow } = require('./mobile-render/components/SiteWindow.js');

const withProviders = (child) =>
  renderToStaticMarkup(
    element(
      AppRouterContext.Provider,
      { value: router },
      element(AuthProvider, null, element(PresenceProvider, null, element(CommsProvider, null, element(NotificationsProvider, null, child)))),
    ),
  );

const frame = withProviders(
  element(SiteWindow, { title: 'DEBASER.SITE', active: 'forum', status: 'READY' }, element('p', null, 'BODY')),
);

/**
 * A control clears the floor if it has a phone-size branch. Two are legitimate: `max-sm:*` for
 * something a phone sees (the title bar's picture, the Start menu's rows), and `max-md:*` for
 * something that only *exists* from `sm` up (`SiteNav`'s keys, which are inside a `hidden sm:flex`
 * band) - a tablet in portrait is held in two hands exactly like a phone, so it wants the same floor.
 */
// (2026-10-23, docs/theming.md) `min-h-11` became `min-h-tap`: the same 44px, from its own token
// (`--spacing-tap`), so the spacing dial cannot shrink a tap target below the floor.
const FLOOR = /max-(sm|md):min-h-tap/;

// Any control that is a glyph rather than a word has to carry the floor. The buttons that are a
// *phrase* (`[ LOG IN ]`) are wider than they are tall and are handled by the shared plates, so this
// holds the ones whose face is one character - which is exactly the set that went wrong.
const singleGlyph = (text) => text.replace(/<[^>]+>/g, '').trim().length <= 3 && !/\[/.test(text);

const glyphs = [...frame.matchAll(/<(a|button)\b([^>]*)>([\s\S]*?)<\/\1>/g)]
  .map((m) => ({ label: m[3].replace(/<[^>]+>/g, '').trim(), classes: (m[2].match(/class="([^"]*)"/) ?? [, ''])[1] }))
  .filter((c) => singleGlyph(c.label));

for (const control of glyphs) {
  assert.ok(
    FLOOR.test(control.classes),
    `the glyph control "${control.label}" carries a phone size (it had "${control.classes}")`,
  );
}

// The panel's own two shells. `lg:` would leave 640-1023px with neither the panel nor the arcade and
// archive keys, since `SiteNav` is `hidden sm:flex` and carries neither.
const sidebarSource = fs.readFileSync(path.join('app', 'components', 'DesktopSidebar.tsx'), 'utf8');
assert.match(sidebarSource, /hidden w-7[^"]*md:flex/, 'the rail opens from a tablet');
assert.match(sidebarSource, /hidden w-60[^"]*md:flex lg:w-72/, 'and the panel with it, wider on a desktop');

// The title bar's picture is the phone's whole navigation, so it has to be a thumb's size there.
const profileSource = fs.readFileSync(path.join('app', 'components', 'ProfileControl.tsx'), 'utf8');
assert.match(profileSource, /PICTURE_SIZE = \{[^}]*compact: 40/, 'the picture grows on a phone');
assert.match(profileSource, /useCompactViewport\(\)/, 'and reads the same breakpoint the shell does');

// The viewport unit. `vh` on a phone is the URL-bar-retracted height, so the window has to be capped
// with `dvh` as well or the frame is taller than the screen it is drawn on.
const windowSource = fs.readFileSync(path.join('app', 'components', 'SiteWindow.tsx'), 'utf8');
assert.match(windowSource, /h-\[84vh\] max-h-\[84dvh\]/, 'the window is capped against the visible viewport');

console.log('ok   phone rules           the glyph controls, the panel breakpoints, the dvh cap');
console.log(`     glyphs held to ${FLOOR}  : ${glyphs.length}`);
