# The DEBASER extension in the Edge Add-ons store (and the Chrome Web Store, kept for later): what to paste and press

Prepared 2026-11-27. Luke: "Yes, prepare it"; "need the extension to be easier to download and update"; to which stores: "Edge Add-ons
store,Firefox, straight from our site,Bookmarks-bar key (no install)" (the Chrome Web Store not chosen); who finds it: "Unlisted / hidden
(Recommended)"; the icon: "generate a text icon for debaser". The developer account and the publishing are Luke's. Everything here is written
from the extension as it is (`extension/`, version in its manifest); change this file when it changes. Store rules checked 2026-11-27 against
Microsoft's and Google's own pages (Sources, below).

## What is ready
- **The zip for the store**: https://debaser.site/api/extension/store-zip (always the version the site runs). The extension as people load it
  by hand, but its manifest has no `key` line (a store gives the extension its own id). No `update_url`; "Chrome" is in neither its name nor
  its description.
- **The logo**: `edge-logo-300.png` in this folder (300 x 300, Edge's size). The extension's own icons are in the zip (16, 32, 48, 128).
  Both are Luke's text icon: the word DEBASER in the site's face and inks, made by `scripts/make-text-icon.cjs` (his exception, art.md).
  Black on Daffodil is the default; `icon-128-transparent.png` beside it is the same word with no field behind it, for Luke to choose by
  looking (2026-11-27). Choosing it means a line in that script and a new extension version.
- **The tile**: `tile-440x280.png` in this folder (optional in Edge; the same text).
- **The screenshots**: `store-*.png` in this folder, 1280 x 800, pretend sites (Edge takes up to 6, and none are required).
- **The words**: under Store listing and Privacy tab, below.

## Edge Add-ons: Luke's steps (on a phone or a computer; free)
1. Open https://partner.microsoft.com/dashboard/microsoftedge and sign in with a Microsoft account. Register as a developer: there is no fee.
2. Press **Create new extension**. Upload the zip: download https://debaser.site/api/extension/store-zip first, then choose that file.
3. **Availability**: choose **Hidden** (only people with the link find it: the EXTENSION window on debaser.site gives the link). Markets: all.
4. **Properties**: category **Productivity**. Privacy policy: **https://debaser.site/privacy** (needed: it sends a page's address to
   debaser.site when the reader presses to send one). Website: **https://debaser.site**. Support contact: an e-mail address of your choosing.
5. **Store listings**, language English: paste the **Description** below (Edge wants 250 to 10,000 characters: it has enough). Logo:
   `edge-logo-300.png`. Small promotional tile: `tile-440x280.png`. Screenshots: the five `store-*.png`. Search terms (optional, up to 7,
   30 characters each): debaser, reader mode, lenses, x-ray, low-fi, comic. The short description comes from the extension itself: nothing to
   paste.
6. **Privacy**: paste the single purpose, each permission's reason, "No" to remote code, and the data answers, all below.
7. **Submit**. In **Notes for certification** paste: "No account is needed. Press the extension's toolbar key on any https page: the side
   panel opens with the lenses (READER, X-RAY, LOW-FI, YOUR THEME). Its own page ([ SITES ]) lists the sites it may act on; it asks for no
   site until one is added there. debaser.site is the companion site." Microsoft says certification takes up to seven business days.
8. When it is published, the **Extension overview** page shows its store address. Its id is the 32 letters at the end of that address: send
   it to the coordinator (or the BROWSER session).

## When the id comes in (the BROWSER session)
Put it in `app/lib/seeing/extension-ids.ts` as `EDGE_STORE_ID`, and push. The site then talks to whichever copy is in (the store's before the
zip's), and in Edge the EXTENSION window offers **[ GET IT FROM THE EDGE ADD-ONS STORE ↗ ]** first, the folder and the zip under OR BY HAND.
Chrome keeps the by-hand route (CHOOSE AN EMPTY FOLDER, or the zip). A store copy updates itself.

## Every new version, after that
Each new version of the extension has to be uploaded to the store as a new package (step 2, on the extension's **Packages** page) and is
reviewed again; then every store copy updates itself. While the store reviews it, a store copy exactly one version behind the site's isn't
told to update (the window says the store is still checking); one two versions behind is told UPDATE IT FIRST again. So each new version
means Luke uploading the store zip once more.

## The Chrome Web Store (not chosen, 2026-11-27: kept as it was for later; not built further)
Asked again the same day ("prepare the Chrome Web Store listing the same way as Edge's?"), Luke: "not now actually because chrome costs
money to have an extension i think" (SPEC-seeing-machine.md, decision 63).
The same zip, words and pictures would do, with Chrome's own rules: the icon 128 x 128 (in the zip already), at least one screenshot, a
one-off registration fee, review from a few days to a few weeks; https://chrome.google.com/webstore/devconsole. Its id would go in
`CHROME_STORE_ID`, and Chrome would then offer that store first in the same way.

## Store listing
**Name**: DEBASER SEEING MACHINE

**Summary** (132 at most): Websites inside debaser.site's BROWSER, signed in as you, through its lenses: reader, x-ray, low-fi, your theme.

**Description**:
The companion to BROWSER on debaser.site, the site of the comic Debaser.

BROWSER shows other websites inside debaser.site. With this extension it shows them as your own browser does, signed in as you, where a
site lets its sign-in work inside another site; and it puts the machine's lenses on any page: READER (the words alone), X-RAY (how a page
is built), LOW-FI (plain, in the site's colours) and YOUR THEME.

- It acts only on sites you add to it, and on the tab you press its key on. Adding a site that shares a sign-in (Google, Microsoft, Apple,
  Meta, Amazon) offers the rest of that company's sites, named first.
- It never reads your passwords or cookies, and sign-in pages are never shown inside anything: you sign in on the site itself.
- It tells debaser.site only its version, its two settings, whether the page in front of you is on its list, and what you press to send
  (a page to look at through the site's own eye, a video to a room).
- IMPORT FROM THIS BROWSER offers the sites your browser has been to in the last 30 days; the browser asks first, and the permission is given
  back at once. Nothing of it leaves your browser.

## Privacy tab
**Single purpose**: shows websites the user chooses inside debaser.site's BROWSER, signed in as the user, and changes how a page looks (lenses)
when the user asks.

**Permission reasons**:
- `declarativeNetRequestWithHostAccess`: to lift a site's "don't show me inside another site" rule, only for sites the user added, only in frames
  in the extension's own page or debaser.site's BROWSER tab while it is open, and never for a sign-in page. The rule lasts only for the session.
- `scripting`: to put a lens on a page when the user presses one (it changes how the page looks; nothing is read from it but what it shows).
- `sidePanel`: the lenses beside an ordinary tab.
- `storage`: the user's two settings, the site's colours, and which sites it was asked about this hour.
- `activeTab`: the tab the user presses the extension's key on, and only it.
- Optional host permissions (any https and http site): asked for one site, or one company's sign-in, at a time, when the user presses ADD.
- Optional `history`: asked for only when the user presses IMPORT FROM THIS BROWSER, used once to list site names, and given back at once.

**Remote code**: No. Every script is in the package.

**Data use** (what the store calls collected: sent off the device):
- Web browsing activity: only the address of a page the user presses to send to debaser.site (to look at it through the site's own eye, or a
  video to a room). Nothing is sent by itself.
- No personally identifiable information, health, financial, authentication, personal communications, location or user-activity data.
- Not sold, not used for anything but the extension's single purpose, not used for credit.

## Sources (read 2026-11-27)
learn.microsoft.com: microsoft-edge/extensions/publish/publish-extension, publish/create-dev-account, getting-started/extension-sideloading;
developer.chrome.com: docs/webstore/images, publish, register, review-process, update; docs/extensions/reference/manifest/key.

## The screenshots
Taken by `STORE_SHOTS=docs/extension-store node scripts/drive-see-extension.cjs` (pretend sites; nobody signed in to anything real): the
machine's page with READER, X-RAY, LOW-FI and YOUR THEME on a pretend shop, and ADD A SIGN-IN with IMPORT.
