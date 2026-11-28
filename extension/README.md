# The DEBASER SEEING MACHINE extension (OWN EYE)

Pages in your own Chrome or Edge, where you are already signed in, through the machine's lenses (SPEC-seeing-machine.md, D1). Nothing of it
passes through debaser.site's server; the sites see your own address.

## Put it in (Chrome or Edge, on a computer)
From debaser.site: your profile's SETTINGS, EXTENSION. It has the download, and once it is in, its settings and its updates. By hand:
1. Open `chrome://extensions` (Edge: `edge://extensions`).
2. Turn on **Developer mode** (a switch on that page).
3. Press **Load unpacked** and choose this folder (`extension`).
4. Press the puzzle-piece key in the browser's bar and pin DEBASER SEEING MACHINE.

## Sign-ins and IMPORT
Adding a site that shares a sign-in (Google, Microsoft, Apple, Meta, Amazon) offers all of that company's sites at once, named first. SITES has
ADD A SIGN-IN and IMPORT FROM THIS BROWSER: the sites this browser has been to in the last 30 days, by name, ticked; the browser asks for leave
to read its history, which is used once and given back. Nothing of it leaves the extension's page.

## Keep it up to date
A browser never updates a folder by itself. In the site's EXTENSION panel, CHOOSE ITS FOLDER once: the site then writes each new version into that
folder, every file checked against a list made when the site was built, and asks the extension to read itself again. The browser asks you first, and
asks again on a later visit unless you let it on every visit. Or download it again, over the same folder, and press its ↻ in the browser's list.

## Take it out
Remove it in `chrome://extensions` (Edge: `edge://extensions`) and delete the folder.

## Use it
- **OWN EYE on debaser.site/browser** opens the page in an ordinary tab of your browser, signed in as you are, with the machine's lenses in its side
  panel (its key in the bar opens that too). IN THE MACHINE opens the machine's own tab instead, which shows a site in a frame.
- **The machine's own tab** The first time for each site it asks to be let: you
  press ADD, and the browser asks too. SITES lists them, each with REMOVE.
- **Its key in the bar** opens a panel beside an ordinary tab, with the same lenses for that tab, and ADD for the site in front.
- **Sign in on the site itself, in an ordinary tab.** Sign-in pages, banks and payment pages are never shown in the machine.
- MEDIA lists what a page plays; TO THE ROOM opens debaser.site with it waiting for your press.

## What it can and can't do
It acts only on sites you add, and on the tab you press its key on; or on every site, once you press ALLOW EVERY SITE under SITES (off until
then; the browser asks first; TAKE IT BACK undoes it). It never reads passwords or cookies. It sends debaser.site nothing but what you press: a
media item's address, or a page's address for the server's eye. To show a site in a frame it lifts that site's no-framing rule, in the machine's
own tab and in BROWSER's tab on debaser.site only, while one is open there, and tells the page in its place who may frame it here.

A site added by name is shown even when that means switching off its own script-safety rules (its Content-Security-Policy) while it is inside
BROWSER or the machine; some sites (DuckDuckGo and GitHub among them) only show that way. ALLOW EVERY SITE alone never does that: such a page
says it didn't show, and offers a tab or ADD. With every site allowed, a few lines of the extension run on every page of the browser and stop at
their first line, reading and sending nothing, unless the page is shown directly inside a debaser.site page or the machine. Inside a
debaser.site page they ask that page one fixed question (is this the frame BROWSER made for OWN EYE?) and say nothing more unless it answers yes:
BROWSER answers its own OWN EYE frame alone, so no other frame on the site (the floating player, a video in a post) is followed, told to BROWSER or
given a lens (0.8.1; before it, any frame directly inside any debaser.site page was).

Its id is `apbecjpegfcbbjjhjbcjojpfajjpokgn` (from the `key` in the manifest: a public key whose private half was thrown away).
