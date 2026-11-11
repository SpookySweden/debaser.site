# foliate-js, pinned for the DEBASER reader

The engine behind `/read/<ref>` (SPEC-reader.md, Luke 2026-11-11). It turns an EPUB into pages: the chapters, the
two-page spread, CFI positions (the standard address of a spot in an e-book), search, and the layer highlights are
drawn on.

- Source: https://github.com/johnfactotum/foliate-js
- Pinned at commit `78914aef4466eb960965702401634c2cb348e9b1` (2026-05-01). Copied 2026-11-11.
- Licence: MIT, `LICENSE` (Copyright (c) 2022 John Factotum).
- `vendor/zip.js` is zip.js by Gildas Lormeau, minified by foliate-js's own build: BSD 3-Clause,
  `vendor/LICENSE-zip.js.txt`. It reads the EPUB's zip in the browser (web workers off).
- No CDN at run time: the site's bundler builds these files in.

## Only what EPUB needs
Copied: `view.js`, `epub.js`, `epubcfi.js`, `paginator.js`, `fixed-layout.js`, `overlayer.js`, `progress.js`,
`search.js`, `text-walker.js`, `tts.js` (view.js imports it; the site doesn't use it), `vendor/zip.js`.
Left out: the comic book, FB2, MOBI and PDF readers (and PDF.js), `dict.js`, `opds.js`, `footnotes.js`, the demo
reader (`reader.html`, `reader.js`, `ui/`).

## The one change from upstream
`view.js`, `makeBook`: EPUB only, from a Blob only. An address is refused, so the engine never fetches a book
itself; the site hands it the Blob its own route passed through. The other formats' branches are cut, because
their files aren't here.

## Scripts in books
foliate-js frames each chapter with `sandbox="allow-same-origin allow-scripts"` (a WebKit bug needs
`allow-scripts` for events). The site stops book scripts itself, in `app/lib/books/reader-engine.ts`: script files
are refused before they load, and every chapter has its `<script>` elements and `on...` attributes removed and a
Content-Security-Policy written into its head (no scripts at all; pictures, styles and fonts only from the book
itself) before the engine draws it.

## Updating
Clone upstream, copy the same files over these, re-apply the `makeBook` change, update the commit above, and run
`npm run checks -- --only check-reader`.
