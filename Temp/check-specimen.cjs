/**
 * The style sheet page (`/specimen`) and its measuring sample.
 *
 * Two things: `SpecimenValue` renders its sample with the token's class and a place for the measured value
 * (filled in the browser, so empty on the server); and the page lists *every* text size, face job and
 * layer that `app/theme/tokens.css` declares - so adding a token without showing it on the page fails here,
 * and the page cannot quietly fall behind the file it is a picture of.
 *
 *   npx tsc app/components/SpecimenValue.tsx app/lib/ui/themes.ts --outDir Temp/specimen-out --module commonjs --target es2020 --moduleResolution node --jsx react-jsx --skipLibCheck --esModuleInterop
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const SpecimenValue = require('./specimen-out/components/SpecimenValue.js').default;

const html = renderToStaticMarkup(React.createElement(SpecimenValue, { property: 'font-size', className: 'text-label' }, 'Sample'));
assert.match(html, /<span class="text-label">Sample<\/span>/, 'the sample wears the token it shows');
assert.match(html, /<span class="text-label text-ink-quiet"><\/span>/, 'and the measured value is left to the browser');

const tokens = fs.readFileSync('app/theme/tokens.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const page = fs.readFileSync('app/specimen/page.tsx', 'utf8');
const declared = (prefix) =>
  [...tokens.matchAll(new RegExp(`^\\s*--${prefix}-([a-z0-9-]+?):`, 'gm'))].map((m) => m[1]).filter((name) => !name.includes('--'));

const missing = [];
for (const name of declared('text').filter((n) => n !== 'field-phone' && !n.endsWith('-line-height'))) {
  if (!page.includes(`'text-${name}'`)) missing.push(`text-${name}`);
}
for (const name of declared('font')) if (!page.includes(`'font-${name}'`)) missing.push(`font-${name}`);
for (const name of declared('z-index')) if (!page.includes(`'z-${name}'`)) missing.push(`z-${name}`);
assert.deepEqual(missing, [], 'the specimen page shows every text size, face job and layer tokens.css declares');

console.log(`specimen checks passed (${declared('text').length} sizes, ${declared('font').length} faces, ${declared('z-index').length} layers listed)`);
