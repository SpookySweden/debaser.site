import type { Metadata } from 'next';
import type { CSSProperties, ReactNode } from 'react';
import SiteWindow from '../components/SiteWindow';
import SpecimenValue from '../components/SpecimenValue';
import { contrastRatio } from '../lib/ui/colour';
import {
  FIELD,
  GLYPH_BUTTON,
  PANEL,
  PLATE,
  PLATE_ACCENT,
  PLATE_HARDWARE,
  PLATE_LARGE,
  PLATE_LINK,
  PLATE_MAIN,
  PLATE_MEDIUM,
  PLATE_ON_BLACK,
  PLATE_PRESSED,
  SHELF_CHIP,
  STATUS_BAR,
  TITLE_BAR,
  TITLE_BAR_BUTTON,
  TITLE_BAR_INACTIVE,
} from '../lib/ui/controls';
import { DYES, THEMES, THEME_TOKEN_NAMES, type Theme } from '../lib/ui/themes';

export const metadata: Metadata = {
  title: 'DEBASER.SITE - Specimen',
  description: 'Every token the site is drawn with, in both themes.',
  robots: { index: false, follow: false },
};

/**
 * The style sheet: every token the site is drawn with, on one page, in both themes at once.
 *
 * Not linked from anywhere. It is the page to look at during a readability round: change a value in
 * `app/theme/tokens.css` or `app/lib/ui/themes.ts` (see `docs/theming.md`), and every size, colour, line
 * and key the site uses is here to judge, instead of hunting for each one across the windows.
 *
 * Each theme is shown by writing its colours onto its own column, the same way the theme switcher writes
 * them onto the page - so the columns are the real themes, not pictures of them. Numbers beside a sample
 * are read from the browser (`SpecimenValue`), so they follow the dials.
 */

/** A theme's colours as custom properties on one element: the switcher's own mechanism, scoped. */
function themeScope(theme: Theme): CSSProperties {
  const scope: Record<string, string> = { colorScheme: theme.scheme };
  for (const token of THEME_TOKEN_NAMES) scope[`--color-${token}`] = theme.tokens[token];
  return scope as CSSProperties;
}

const INKS = ['ink', 'accent-ink', 'ink-quiet', 'ink-plate', 'ink-bar', 'paper'] as const;
const SURFACES = ['paper', 'sun-pale', 'chrome-dark', 'pointed', 'sun', 'ena', 'hardware', 'bubble-pale', 'acid', 'bubble'] as const;

const TYPE = [
  ['text-label', 'the smallest label: captions, counts, small keys, rows'],
  ['text-key', 'keys with a line to themselves, larger labels'],
  ['text-prose', 'writing: posts, comments, comms, lore, bios, fields'],
  ['text-title', 'title lines'],
  ['text-heading', 'a heading inside a window'],
  ['text-display', 'the largest glyph or heading in a window'],
  ['text-headline', "a lore page's first heading"],
  ['text-sm', "a phone's key size (carries its own line spacing)"],
  ['text-base', 'a larger phone key'],
  ['text-xl', 'page headings'],
  ['text-4xl', "a game board's marks"],
  ['text-5xl', "a game board's marks, wider screens"],
] as const;

const FACES = [
  ['font-body', 'everything: prose, labels, keys'],
  ['font-mono', 'fields, numbers, code'],
  ['font-display', 'titles, once they get their own face (nothing wears it yet)'],
  ['font-emote', "RADI-OH's text faces"],
] as const;

const SPACING = ['w-0.5', 'w-1', 'w-2', 'w-3', 'w-4', 'w-6', 'w-8', 'w-12', 'w-16'] as const;

const LAYERS = [
  ['z-menu', 'the start menu'],
  ['z-dock', 'a docked window'],
  ['z-banner', "the guest's alarm banner"],
  ['z-popout', 'a pop-out window and its scrim'],
  ['z-overlay', 'a pop-up over a pop-out'],
] as const;

const MOTION = [
  ['animate-flash', 'the press'],
  ['animate-blip', 'the one glyph that says something is alive'],
  ['animate-alarm', 'the fault banner'],
  ['animate-hop', "a RADI-OH face under the pointer"],
] as const;

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={`${PANEL} mt-4`}>
      <div className={TITLE_BAR_INACTIVE}>
        <span>{title}</span>
      </div>
      <div className="space-y-3 p-3">{children}</div>
    </section>
  );
}

function ThemeColumn({ theme }: { theme: Theme }) {
  return (
    <div style={themeScope(theme)} className="desktop-tile min-w-0 flex-1 p-2 text-ink">
      <div className={`${PANEL} space-y-3 p-2`}>
        <div className={TITLE_BAR}>
          <span>{theme.label}</span>
          <span>[ {theme.id} ]</span>
        </div>

        <div>
          <p className="mb-1 text-label text-ink-quiet">COLOURS BY JOB</p>
          <ul className="grid grid-cols-2 gap-1 sm:grid-cols-3">
            {THEME_TOKEN_NAMES.map((token) => (
              <li key={token} className="flex items-center gap-2 text-label">
                <span className="h-5 w-5 shrink-0 border border-ink" style={{ background: `var(--color-${token})` }} />
                <span className="min-w-0">
                  {token}
                  <br />
                  <span className="text-ink-quiet">{theme.tokens[token]}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="overflow-x-auto">
          <p className="mb-1 text-label text-ink-quiet">INKS ON SURFACES (CONTRAST; 4.5 IS THE FLOOR)</p>
          <table className="text-label">
            <thead>
              <tr>
                <th className="p-1 text-left">ink \ on</th>
                {SURFACES.map((surface) => (
                  <th key={surface} className="p-1 text-left">
                    {surface}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {INKS.map((ink) => (
                <tr key={ink}>
                  <th className="p-1 text-left">{ink}</th>
                  {SURFACES.map((surface) => {
                    const ratio = contrastRatio(theme.tokens[ink], theme.tokens[surface]);
                    return (
                      <td
                        key={surface}
                        className="p-1"
                        style={{ background: `var(--color-${surface})`, color: `var(--color-${ink})` }}
                      >
                        {ratio.toFixed(1)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="space-y-2">
          <p className="text-label text-ink-quiet">KEYS</p>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={PLATE}>[ PLATE ]</button>
            <button type="button" className={PLATE_MEDIUM}>[ MEDIUM ]</button>
            <button type="button" className={PLATE_LARGE}>[ LARGE ]</button>
            <button type="button" className={PLATE_MAIN}>[ MAIN ACTION ]</button>
            <button type="button" className={PLATE_PRESSED}>[ PRESSED ]</button>
            <button type="button" className={PLATE_ACCENT}>[ ACCENT ]</button>
            <button type="button" className={PLATE} disabled>
              [ DISABLED ]
            </button>
            <span className={PLATE_LINK}>[ LINK ]</span>
            <span className={SHELF_CHIP}>[ SHELF CHIP ]</span>
            <button type="button" className={PLATE_HARDWARE}>[ DECK ]</button>
            <button type="button" className={TITLE_BAR_BUTTON}>[ × ]</button>
            <button type="button" className={`${GLYPH_BUTTON} h-6 w-6`}>?</button>
          </div>
          <div className="bg-hardware p-2">
            <button type="button" className={PLATE_ON_BLACK}>[ ON BLACK ]</button>
          </div>
          <input className={FIELD} defaultValue="A field: writing goes here." aria-label="Sample field" />
          <p className="w-fit bg-bubble-pale px-1 text-label text-ink-bar">A FAULT CHIP: WHITE ON ROSE</p>
        </div>

        <div className="space-y-2">
          <p className="text-label text-ink-quiet">TITLE LINES AND BARS</p>
          <div className={TITLE_BAR}>
            <span>THE WINDOW YOU ARE IN</span>
          </div>
          <div className={TITLE_BAR_INACTIVE}>
            <span>FURNITURE</span>
            <span>[ 3 :: ALL ]</span>
          </div>
          <div className={STATUS_BAR}>
            <span>A STATUS LINE</span>
            <span>READY</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function SpecimenPage() {
  return (
    <SiteWindow title="DEBASER_OS - v1.0 [SPECIMEN]" status="Every token, both themes">
      <h1 className="mb-2 text-xl">DEBASER.SITE // SPECIMEN</h1>
      <p className="mb-2 text-prose leading-normal">
        Every size, colour, line and key the site is drawn with, in both themes at once. Not linked from anywhere.
        Values live in app/theme/tokens.css (sizes, lines, faces, layers, motion) and app/lib/ui/themes.ts
        (colours); docs/theming.md says how to change each.
      </p>

      <div className="flex flex-col gap-2 lg:flex-row">
        {THEMES.map((theme) => (
          <ThemeColumn key={theme.id} theme={theme} />
        ))}
      </div>

      <Section title="THE NINE DYES">
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {Object.entries(DYES).map(([name, hex]) => (
            <li key={name} className="flex items-center gap-2 text-label">
              <span className="h-8 w-8 shrink-0 border border-ink" style={{ background: hex }} />
              <span>
                {name}
                <br />
                <span className="text-ink-quiet">{hex}</span>
              </span>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="TYPE (--scale-type)">
        <ul className="space-y-2">
          {TYPE.map(([token, job]) => (
            <li key={token} className="rule-pixel pb-2">
              <p className="text-label text-ink-quiet">
                {token} :: {job}
              </p>
              <SpecimenValue property="font-size" className={token}>
                The quick brown fox - DEBASER_OS 0123456789
              </SpecimenValue>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="FACES (app/theme/fonts.ts)">
        <ul className="space-y-2">
          {FACES.map(([token, job]) => (
            <li key={token} className="rule-pixel pb-2">
              <p className="text-label text-ink-quiet">
                {token} :: {job}
              </p>
              <p className={`${token} text-prose`}>The quick brown fox jumps over the lazy dog. (^_^) d-_-b 0123</p>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="LINES">
        <div className="flex flex-wrap items-start gap-4 text-label">
          <SpecimenValue property="border-top-width" className="block border-line border-ink p-2">
            border-line
          </SpecimenValue>
          <SpecimenValue property="border-top-width" className="block border-thick border-ink p-2">
            border-thick
          </SpecimenValue>
          <SpecimenValue property="border-top-width" className="block border border-ink p-2">
            border (hairline)
          </SpecimenValue>
          <SpecimenValue property="border-top-width" className="frame block p-2">
            .frame (the window outline)
          </SpecimenValue>
        </div>
        <ul className="text-label">
          <li className="rule-pixel py-1">.rule-pixel - the rule between rows</li>
          <li className="rule-pixel py-1">.rule-pixel</li>
        </ul>
      </Section>

      <Section title="SPACING (--scale-space)">
        <ul className="space-y-1">
          {SPACING.map((width) => (
            <li key={width} className="flex items-center gap-2 text-label">
              <span className={`h-3 shrink-0 bg-ink ${width}`} />
              <SpecimenValue property="width" className={`block h-0 ${width}`}>
                {''}
              </SpecimenValue>
              <span>{width}</span>
            </li>
          ))}
          <li className="flex items-center gap-2 text-label">
            <span className="h-tap w-tap shrink-0 border border-ink" />
            <SpecimenValue property="height" className="block h-tap w-0">
              {''}
            </SpecimenValue>
            <span>h-tap / min-h-tap: the phone tap target, a floor that ignores the dial</span>
          </li>
        </ul>
      </Section>

      <Section title="LAYERS">
        <ul className="isolate text-label">
          {LAYERS.map(([token, job]) => (
            <li key={token} className="rule-pixel py-1">
              <SpecimenValue property="z-index" className={`relative ${token}`}>
                {token} :: {job}
              </SpecimenValue>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="MOTION (steps, never eased)">
        <ul className="text-label">
          {MOTION.map(([token, job]) => (
            <li key={token} className="rule-pixel py-1">
              <SpecimenValue property="animation-duration" className={`inline-block ${token}`}>
                {token} :: {job}
              </SpecimenValue>
            </li>
          ))}
        </ul>
      </Section>
    </SiteWindow>
  );
}
