# The DEBASER extension in the Chrome Web Store: what to paste, and what to press

Prepared 2026-11-27 (Luke: "Yes, prepare it"). The developer account, the fee and the publishing are Luke's. Everything here is written from the
extension as it is (`extension/`, version in its manifest); change this file when it changes.

## What Luke has to press, in order
1. Draw the two pictures the store needs (artwork is Luke's alone): an icon 128 x 128 (PNG, a 96 x 96 drawing with 16 transparent around it),
   and a small promotional tile 440 x 280 (PNG or JPEG). Put them in `assets/extension/` as `icon-128.png` and `tile-440x280.png`, and tell
   the BROWSER session: it adds the icon to the manifest (`icons` and the toolbar key) and makes a new version.
2. Go to https://chrome.google.com/webstore/devconsole and sign in with the Google account that will own it. Pay the one-off registration fee
   (5 US dollars) and fill in the contact page.
3. **New item**, and upload the zip from https://debaser.site/api/extension/zip (always the version the site runs). If the upload refuses
   the manifest's `key` line, tell the BROWSER session: it makes a store copy without it.
4. **Store listing**: paste the words below; add the five screenshots in this folder (`store-*.png`, 1280 x 800); the tile; category
   Productivity; language English (UK).
5. **Privacy**: paste the single purpose, each permission's reason, and the data answers below. Privacy policy: https://debaser.site/privacy
6. **Distribution**: Unlisted (only people with the link: the EXTENSION window would give it) or Public. Then **Submit for review**.
7. When it is published, tell the BROWSER session the item's id (the store gives a new one). The site then asks for either id, and the
   EXTENSION window offers the store's page instead of the zip, so it updates by itself like any extension.

Microsoft's Edge Add-ons store is the same, free: https://partner.microsoft.com/dashboard/microsoftedge (the same zip and words).

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

## The screenshots
Taken by `STORE_SHOTS=docs/extension-store node scripts/drive-see-extension.cjs` (pretend sites; nobody signed in to anything real): the
machine's page with READER, X-RAY, LOW-FI and YOUR THEME on a pretend shop, and ADD A SIGN-IN with IMPORT.
