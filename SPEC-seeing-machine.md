# SPEC: BROWSER, the DEBASER SEEING MACHINE

Luke, 2026-11-23, from his master text ("THE DEBASER SEEING MACHINE") and the interview the same day ("interview me regarding
this prompt and all your ideas an creative context on implementing the idea to the site, account for themes, browser to be a
new module").

Status: **building (2026-11-23). Phases 1 to 4 are built; the server's eye is for Luke's account only.** What was built and what works: `docs/seeing-machine.md`. The audit behind this
is `seeing-machine-audit.md` in the sessions' notes folder; the parts that matter are repeated here.

Words used here: an **eye** is a way of getting a page (the site's server fetches it, or the reader's own browser does). A
**lens** is a way of showing it. The **frame** is the box the page is drawn in. A **watcher** is a company whose code or
picture on a page reports who is reading it. A **capture** is a page kept on the site.

## Luke's answers (2026-11-23)
| # | Question | Answer |
| --- | --- | --- |
| – | Cloudflare's no-proxy rule and the route | **"use cloudflare for now, will use my server once moving house"** |
| 1 | Who can use it | **Everyone** |
| 2 | Which address sites see | **Always home** |
| 3 | Name | **BROWSER** on the bar, THE SEEING MACHINE in the title |
| 4 | Where it opens | **A page, like LEAGUEBOT, with tabs** |
| 5 | Themes | **The window wears your theme; each lens uses it in its own way; STANDARD is left alone** |
| 6 | First lenses | **STANDARD, READER and WATCHERS; then X-RAY; LOW-FI and THEME DYE; CUSTOM** |
| 7 | A page's scripts | **On from the start** |
| 8 | Ideas | **"all of them including the non stars make sure"**: i to xvi, every one is in a phase below |
| 9 | Media the Room can't play | **Plays in the page only, "but ideally find a way"**: the ladder below |
| 10 | Where ads were | **STREAM ART, always** |
| 11 | What a capture keeps | **A full copy of the page** |
| 12 | Who sees a capture | **Everyone straight away** |
| 13 | Where captures go | **Ctrl+K, letters, forum, recommendations first; MEDIA's feed and DISCOVER after** |
| 14 | Logins | **"i need it to have real browser functionality so any user can sign in with their google"** |
| 15 | History | **On the account, private** |
| 16 | Bad sites | **Known malware and phishing blocked** |

## The four last answers (Luke, 2026-11-23: "d1,a d2,a, d3,a, kept forever, d4,a")
**D1. Google sign-in (answer 14): A, a DEBASER browser extension** (the OWN EYE, below). It can't go through the site's server:
- Google blocks it on purpose. Its published rule refuses sign-in inside embedded or automated browsers and where the
  network path is altered, naming "man-in-the-middle" as the reason
  ([2020 rule](https://developers.googleblog.com/2020/08/guidance-for-our-effort-to-block-less-secure-browser-and-apps.html),
  [supported browsers](https://support.google.com/accounts/answer/7675428)).
- A page at debaser.site showing Google's sign-in form and passing the password on is technically the same thing as a
  phishing site, and everyone's passwords and live sessions would sit on SERVER. Never built, whatever else changes.

With the extension, pages load in the reader's own Chrome or Edge, where they're already signed in; no password or private
page passes through SERVER, and those sites see the reader's own address, not the home's. One install, computers only, and a
Chrome Web Store listing in Luke's name (a one-off fee, about $5; he makes it himself) or a folder loaded by hand.

**D2. Everyone = everyone with an account** (A). Signed out, BROWSER shows the sign-in call and the public cards.

**D3. A record of who went where (A), "kept forever"**: account, site name and time, never the page or its address. Readable by
Luke only. Kept with no end date, so it's in every backup too. Said once: a permanent record of which sites people visited is
the most private thing the site would hold, and a leak of SERVER or a backup leaks it. UK data law expects a reason to keep
such a record, for people to be told, and their own rows to be given or removed when they ask; the reason is showing who did
something from the house's connection. So: people are told plainly, "kept forever" included, the first time they open BROWSER
and on /privacy; a request to see or remove somebody's rows is done by hand, by Luke's OK each time. It covers the server's eye
only: what the extension loads never passes through SERVER, so it isn't recorded.

**D4. Public full copies (A)**: everyone sees the card and quotes at once; the full copy opens for people with an account.

## Decisions taken for Luke (2026-11-23; his words, relayed by the coordinator session: "answers its own questions until it's finished every single idea")
Each can be changed later by saying so.
1. **No parse5.** The rewriter reads tags as a browser's tokenizer does and passes the page through, so no new dependency was needed.
2. **The eye says what it is** (`SeeingMachine/1.0`), and does not pretend to be Chrome. Some sites turn it away; getting past that is out of scope.
3. **IPv4 only**, because the house's own machines have IPv6 addresses that look public.
4. **Pages are asked of 1.1.1.2** (Cloudflare's resolver that knows malware and phishing), answer 16.
5. **Words that are not an address are searched for** (Luke, 2026-11-23: "allow the ability to search using a list of multiple search engines such as
   Google, bing and your best ideas, don't ask me just do it"; it replaces an earlier no). Engines that turn servers away open in OWN EYE or a new tab.
6. **A link from outside waits for GO**; a page may send itself on three times in twenty seconds, then no more.
7. **A frame inside a page is a link to it**, `[ FRAME: … ]`, rather than a page in a page.
8. **A BILLBOARD press opens the STREAM ART shelf in a tab**, because a piece has no address of its own.
9. **READER keeps the theme's paper first**, with the book reader's three, and six text sizes; kept in the browser.
10. **Files come from debaser.site until `see.debaser.site` exists**, each with a policy that takes every right away.
11. **OWN EYE opens in the extension's own page**, with the side panel on an ordinary tab beside it: the trial (2b) showed a frame in
    debaser.site is always signed out, and the extension's own page is not. Table: `docs/seeing-machine.md`.
12. **SCAN uses wiby.me's random page**, a public list of the small, old web; GOOD keeps a page on the list in a new tab.
13. **LOUPE starts at 2×**, and SEAM with READER on the right; both are a second drawing of the page, so its scripts run twice.
14. **LOW-FI's and DYE's pictures are dithered in the browser**, from the files already fetched. Faces go the colours of your theme.
15. **The extension lifts a whole site's policy in its frame**, because a browser can't lift the no-framing line alone; only there, only for sites
    you add, and never for sign-ins. Its READER is its own, over the live page.
16. **Rung 3 of the ladder waits**: it needs a new kind of queue row, which is a database change. Rung 4 waits for SCREENS' relay key.
17. **`[ SEE ]` shows only for people with BROWSER on their bar**, so nobody else sees a key that would refuse them.
18. **Phase 5 is on the site** (Luke, 2026-11-23: "you have the database okays make sure nothing is waiting on me"), in four migrations that only add.
19. **A kept copy is refused for a page that is nothing but a sign-in**, not for one that has a password box somewhere on it.
20. **A card's picture is carried in it**, shrunk by the server, so a list of cards asks nothing of anybody's site.
21. **Notes are everybody's, drawings yours alone**: a note is a line on a page; a drawing over a page is kept in this browser.
22. **The extension updates in its own folder**, written by the site with your leave, every file checked; a browser updates such a folder no other
    way short of its own store, which is yours alone to list it in.
23. **Nineteen themes**, not the eighteen written below: MARMALADE has six.
24. **SEEN TOGETHER never opens a page on its own**: whoever shows a page leads, the others see `[ SEE TOGETHER ]` and choose; following
    moves a page already in front. Anybody in the room can say anything, so nothing said there opens anything.
25. **A new tab says what the machine is in one line**, lists its keys, then SEEN LAST (eight pages), GOOD, and the engines under them.
26. **Keys: / the box, Alt+N, Alt+W, Alt+1 to 8**; never Ctrl+T, Ctrl+W, Ctrl+L or Alt+D, which the browser keeps.
27. **A refusal fills the page**: its reason as a title, what it means in a line, and only the keys that may help (TRY AGAIN, OLD COPY, OWN EYE, ITS OWN SITE). A guard's refusal offers nothing.
28. **The tool row is three groups split by a hairline**: yours (HISTORY, KEPT), this page (KEEP to SCRIPTS OFF), out of the machine (SHOW MY ROOM, OPEN SOURCE, OWN EYE).
29. **An address typed in the site search (Ctrl+K) gets [ SEE IT IN BROWSER ]**, for whoever has BROWSER on the bar; the press opens it at once, as [ SEE ] does.
30. **A new tab shows only the keys that work without a page**: SCAN, HISTORY and KEPT; SEAM, LOUPE, ERASE, GOOD, MEDIA and SONIFY come with the first page (MEDIA stays while it holds something sent). Undo: show them again, greyed.
31. **A refused page ends with its trace**: EYE (which eye was asked), ASKED (the address), ANSWER (the reason and how long until it came). Nothing it cannot see from this side, so no per-step trace. Undo: drop the three lines.
32. **At phone width the page keeps a usable height** (22rem) and the machine scrolls to it, rather than squeezing it under the keys. Undo: the two max-sm classes in SeeingMachine.tsx.
33. **While a page is asked for, the view is drawn**: a 2px dither field with a panel saying the step, the address and the eye, and a paper band stepping down it in twelve jumps (still under reduced motion and after STOP, which says STOPPED). Undo: SeeingAcquiring.tsx and .seeing-acquiring in globals.css.
34. **HISTORY and KEPT sit at the far end of the tab line**, being yours whatever the page; the tool row under the lenses holds only what works on the page in front. Undo: the end prop of SeeingTabs back into the tool row.
35. **Alt+L turns to the next lens** (STANDARD, READER, WATCHERS ... round again), remembered for the site as a press is; listed with the other keys. Undo: the KeyL line in keys.ts.
36. **The status line ends with how long the page took** ("· IN 412 MS"), timed on this side from the press to the drawing, as a refusal's trace is. Undo: the ms in the shown state.
37. **The TIME DIAL is a key, [ TIME ], until pressed**; on an old copy it is open at its year. Undo: dialShown in SeeingTools.tsx back to dial !== null.
38. **The lenses and the tools share their lines**, a hairline between them (desktop only), wrapping where they must: a built-in page has one row of keys under the address, an outside page two (it was three). Undo: the data-seeing-keyrow wrapper in SeeingMachine.tsx out, and the two `contents` roots in SeeingLenses.tsx and SeeingTools.tsx back to their own flex rows.
39. **A book seen in BROWSER has [ READ IT ]**, into the site's own reader: an Open Library work's page, an Internet Archive book reader (/stream/) or a PDF or EPUB in an item (/download/); on the OUT group and first on a refusal. An Archive item's page alone gets none (it may be a film). Undo: drop readerRef (read-ref.ts) from SeeingMachine.tsx and SeeingRefused.tsx.
40. **A page tunes in when it arrives**: the busy view's dither lies over it and is cut away from the top in six jumps, a third of a second (also on a tab switch); never under reduced motion, never takes the pointer. Undo: the seeing-arrive div in SeeingStage.tsx.
41. **Alt+H opens HISTORY and Alt+K KEPT**, each a toggle, one in the other's place; Escape puts them away (and is left alone when neither is open); listed with the other keys. Undo: the KeyH, KeyK and Escape lines in keys.ts.
42. **A news feed (RSS, Atom) is drawn as its list**: its title, a count, then each item as a link with its date and up to 300 plain characters of what it says; nothing of the feed's own markup, only http(s) links. OPEN SOURCE still opens the feed itself on its own site. Undo: the feed line in server/open.ts (feed.ts then unused).
43. **A page that builds itself and comes out empty is said to**: the hook counts what came out 4 and 10 seconds after it is drawn (counts only, as X-RAY's), and when a page with scripts of its own (and its scripts on) has not a word, picture, link or frame, a line over the page says so and that OWN EYE or OPEN SOURCE shows it. Undo: the two census timers in hook.ts and the data-seeing-empty line in SeeingStage.tsx.
44. **[ FEED ] for a page that says it has a news feed** (its <link rel=alternate> of RSS or Atom; the first of three noted): it opens the feed as its list (42). Beside MEDIA in the page keys, only when there is one. Undo: the data-seeing-feed button in SeeingMachine.tsx.
45. **X-RAY's MADE OF rows point into the page**: a row pointed at or reached by the keyboard outlines its part of the page in the theme's bubble colour, and lets go when the pointer leaves the list or the focus moves on. The row carries a selector of the one shape ERASE uses, checked again when it arrives. Undo: the lit prop (SeeingStage, SeeingViewport) and the row buttons in SeeingXray.tsx.
46. **A refused page keeps only the keys that may help**: the lenses, SCAN, GOOD, TIME, READ IT, OPEN SOURCE and OWN EYE stay; KEEP PAGE, NOTES, GRAFFITI, MEDIA (unless something waits in the tray), SEARCH THIS, SONIFY, SCRIPTS OFF, SHOW MY ROOM, SEAM, LOUPE and ERASE are put away rather than greyed, as a new tab puts them away (decision 30). The bar is one row shorter there. An X-RAY row pressed, or reached by the keyboard, also brings its part into sight (hovering alone leaves the page still). Undo: `working` in SeeingMachine.tsx and `refused` in SeeingTools.tsx; the hook's reach tool.
47. **A refused page is a dead channel under its words**: the reason, its keys and the trace sit on paper at the top; the rest of the view is faint raster lines with no picture (the theme's quiet ink at 30%, one line in five), still, never moving. Undo: `.seeing-dead` in globals.css and its div in SeeingRefused.tsx.
48. **A site's check that a person is asking is said to be one**: a page whose title is Cloudflare's "Just a moment...", "Attention Required", "Verify you are human" and the like, or that carries a challenge service's mark (Cloudflare, hCaptcha, reCAPTCHA, DataDome, PerimeterX, Imperva, DDoS-Guard) with a 403, 429 or 503, gets a line over it: the machine never answers those; OWN EYE or OPEN SOURCE can. Nothing is worked round. Undo: bot-check.ts and its line in SeeingStage.tsx.
49. **A new tab lists the engines to read, not to arrange**: each engine that is on, its name (pressed, it is the one asked) and its letters, three groups across; ALL, the arrows, ON/OFF and adding your own are behind [ ARRANGE ] beside the heading. The list from the box (▾ and `!`) is always whole. Undo: `whole` in SeeingEngines.tsx.
50. **The status line weighs the page**: "· PAGE 48 KB" after REFUSED, the page's own markup counted in bytes (an old encoding is counted once read; its files are not in it), measured once a page. A readout of what really came, as an instrument would. Undo: the PAGE part in status-line.ts.
51. **An unusual port is said before GO**: "THE SERVER'S EYE ASKS ONLY PORTS 80 AND 443 · GO TO ..." under the box for an address on another port. It is still taken as an address (GO shows the refusal, with OWN EYE to try). Undo: oddPort in search.ts.
52. **The house's own addresses are said at the box**: [::1], 127.0.0.1, 10.x, 192.168.x, 172.16-31.x, 169.254.x and 100.64-127.x, and names ending .local, .lan, .home, .internal, .intranet, .corp, .private, .arpa, .onion or .ts.net, read NOT A PUBLIC ADDRESS before GO, as localhost:3000 already did; the server's own list still decides. Undo: INSIDE_IPV4, INSIDE_NAME and the [ test in address.ts.
53. **OWN EYE first** (Luke, 2026-11-23: "make own eye option default in the browser"): with the extension, a page pressed for opens in your own
    browser, signed in; the server's eye is one press away and remembered as the choice when switched. YouTube offers LOG IN on entering until it is
    on the list, with NOT NOW and DON'T ASK AGAIN; ADD THIS SITE says in words whether the site in front is on the list. Adding a site is one press
    here, one in the extension's page, and the browser's own box: only the extension may ask the browser, and only on a press of its own.
54. **OWN EYE is an ordinary tab** (Luke, 2026-11-27: "by default people are using this browser signed in and can use it like they would chrome or
    edge"): the page in the browser's own tab with the machine in its side panel, because that is the way that behaves exactly like the browser, and
    YouTube's videos play there (in the machine's frame they played white). The machine's own page is one press away for the lenses that need it.
    Every account is asked for the extension first; YouTube's sign-in line is for the server's eye now, since OWN EYE opens signed in already.
55. **OWN EYE is inside BROWSER's own tab** (Luke, 2026-11-27: "i also need own eye to not open in a new tab but inside a 'new tab' inside of
    debasers browser module"; it replaces 54's default): the page in a frame on BROWSER's page, signed in where the site lets its sign-in work inside
    another site, a real tab and the machine's page one press away. YouTube's videos are its own player. Nothing loosens a site's cookies.
    **Every key named OWN EYE does that, whichever eye is the choice** (Luke, 2026-11-27: "it seems own eye still opens a new tab in edge when
    i click it, i did ask before for this to open inside of my site as a new tab in the browser module"): the eye switch's OWN EYE key on the tool row (one control
    with both eyes since the same day, the eye showing the page drawn pressed, a press remembered: "these need to really state their purpose
    better"), a refused page's, the "needs your own browser" page's, and words to an engine that turns the house away. A tab of the browser is opened only by a
    key whose name says tab (`[ IN A TAB ↗ ]`; `LOG IN TO … IN A TAB ↗`, since a sign-in page is never framed, D1).
56. **A sign-in brings its company** (Luke, 2026-11-27: "link your sign ins to add all related pages ... and have an import button"): adding a
    Google, Microsoft, Apple, Meta or Amazon site offers all of that company's sites, named first, in one box of the browser's. IMPORT reads the
    browser's history (site names, 30 days), not its cookies, asked for on the press and given back at once.
57. **The first visit says what each eye is for**, and that the server's eye writes down sites opened, kept with no end date (Luke's "Keep
    forever", 2026-11-27), as D3 always asked; /privacy says it too.
58. **OWN WEB keeps what the owner opens from the house** (Luke, 2026-11-27, typed here: "Yes, change it"): each page a copy, private, once a
    day per address, on the phase 5 tables; his alone for now. Never what his own browser shows, a sign-in, or a form. Deleted by page, site or all.
    He also told the coordinator (2026-11-27): "drop own web but also change the rule, incorporate the things so that the lesnes work while people
    are still able to be signed in on the sites etc". Asked which stood, he chose (2026-11-27, to the coordinator): "Keep OWN WEB live
    (Recommended)". So OWN WEB stays as built; the other half of that message became decision 59.
59. **Lenses on a signed-in page** (Luke, 2026-11-27: "incorporate the things so that the lenses work while people are still able to be signed in
    on the sites"): a lens on the page OWN EYE shows inside BROWSER is worn by the extension on the site's own page, in the reader's own browser, so
    they stay signed in; nothing of the page is fetched by the house or kept. The house-only lenses say so.
60. **The extension may be allowed on every site in one press, for whoever wants that** (Luke, 2026-11-27, to "BROWSER extension: may it be
    allowed on every site in one press, instead of adding each site one at a time (today even the default search, DuckDuckGo, must be added
    before OWN EYE shows it inside BROWSER)?": "One optional key (Recommended)"): a key ALLOW EVERY SITE beside the site list, the browser's
    own box, and a way to take it back. Site by site, sign-in groups and IMPORT stay. Sign-in pages are still never framed. Not built yet.
61. **OWN WEB keeps the pages OWN EYE shows too, by itself** (Luke, 2026-11-27, to "OWN WEB: should pages you open through OWN EYE (your own
    signed-in browser) be kept in your web too? Today only pages fetched by the server's eye are kept, so with OWN EYE as the default your
    web barely fills.": "Keep every page"; chosen over a KEEP press with the risk stated: the text of signed-in pages, mail and bank
    included, is stored on SERVER). It changed decision 58's "never what his own browser shows". Built in extension 0.8.2 (2026-11-28),
    after a plan read by the coordinator: the words go from the person's browser to their own account, private, once a day per address;
    no database change was needed (the rules already let a person keep their own private page, proved once with TEST ACCOUNT A and B);
    /privacy was rewritten in the same push. How it is built: docs/seeing-machine.md, "OWN WEB keeps the pages OWN EYE shows".
62. **The server's eye stays Luke's alone** (Luke, 2026-11-27, to "BROWSER's server's eye (pages fetched by SERVER itself, for someone
    without the extension): who may use it? Today only you; any other account without the extension sees THE MACHINE HAS NO EYE YET.":
    "Only me (Recommended)"). `SEEING_OPEN` stays unset; nothing to build.
63. **No Chrome Web Store listing for now** (Luke, 2026-11-27, to "BROWSER extension: prepare the Chrome Web Store listing the same way as
    Edge's (your morning answer was "Yes, prepare it", your later routes answer left Chrome out)?": "not now actually because chrome costs
    money to have an extension i think"). Chrome keeps the by-hand route.
64. **OWN EYE's pages go into HISTORY on the account too** (Luke, 2026-11-28, to "BROWSER's HISTORY: should pages OWN EYE shows (your own
    browser, signed in) also be kept on your account like other history, so they follow you to another device?": "On the account too";
    as he read it: "The address and title of signed-in pages are stored on SERVER, read by you alone, cleared by the same CLEAR key.").
    Address and title only, through `browse_history` and its "own history" rule as they are; no schema change. It replaces the
    this-browser-only half built first (84517f1).
65. **Four tools also work on a page OWN EYE shows, done by the extension** (Luke, 2026-11-28, to "BROWSER: which tools should also work
    on a page OWN EYE shows (your signed-in browser), done by the extension instead of by the house's copy? Each needs an extension
    update.": "MEDIA,SEARCH THIS,WATCHERS,ERASE"). SEAM, LOUPE, SCRIPTS OFF, SONIFY, SHOW MY ROOM stay the house's. Built in extension 0.8.2
    (2026-11-28): each is done by the extension on the one frame BROWSER made, on a press, and what it finds is handed to BROWSER's page
    in the reader's browser and stored nowhere on the site; never on a never-list page.
66. **OWN WEB keeps every page OWN EYE shows, with no never-keep rule** (Luke, 2026-11-28, to "OWN WEB, now that it will keep every page
    OWN EYE shows automatically (your choice): which pages should it never keep?", offered pages with a password box, sites he marks
    NEVER KEEP, a starting list of mail and banks: "none"). The house's lines stand whatever is kept (the coordinator's, not his taste):
    the page's visible words only, never what is typed in any box, a password, a hidden or one-time-code field, cookies, storage or
    headers; read by that account alone; the page says it is being kept. The switch for it is its own, lives in the extension (so
    the extension refuses to hand a page's words to anything while it is off), is per browser, starts OFF for everybody and is turned
    on by a press on the extension's own page with the plain words; only pages shown inside BROWSER, never an ordinary tab. The last
    three are the builder's safe defaults, named to Luke by the coordinator. Built in extension 0.8.2 (2026-11-28) as written here; the
    extension's own never-list (sign-ins, the listed banks, payments) is still never framed, so never read. One limit told to him: a
    page that prints what is typed somewhere else on itself can't be told from ordinary words.
67. **A page keeps its own script-safety rules inside BROWSER, unless its site was added by name** (Luke, 2026-11-28, told that a site
    he ADDED has always run without its Content-Security-Policy while shown inside BROWSER, and asked "Do you want to choose between A,
    B and C for sites that only show with their script-safety rules off: "Ask me now" or "Keep your default"?": "Keep your default").
    The default he had read: "C. Only for sites you added by name: EVERY SITE shows the unaffected sites with nothing lost; an affected
    site shows only if you also ADD it by name, and the ADD key says what that costs. Same as today for sites you add; nothing wider."
    The three kinds of page and the reading of 20 sites: docs/seeing-machine.md, "What the frame rule does to a page's headers".

## Risks, said once
1. **SERVER is beside everything.** The torrent page (no password at home), Jellyfin, the database and its dashboard, the
   screens engine, the remote-desktop gateway, the router and Tailscale are all reachable from the machine doing the
   fetching. This is proved shut first (Proof, "the attack list"), before anybody but Luke can use it.
2. **Your home address** is what sites see for everything fetched by the server's eye, whoever asked. A stranger's browsing
   looks like yours, to sites and to your internet provider. D2, D3, the limits and the malware block reduce this. They
   don't remove it.
3. **Pictures of anything can pass through SERVER.** Only malware and phishing are blocked (answer 16). Illegal pictures
   would pass through and look like yours. Nothing fetched is written to disk except a capture.
4. **Cloudflare's terms** (2.2.1(j), read 2026-11-23): not to be used "to provide a virtual private network or other similar
   proxy services", no personal exception. Luke: Cloudflare for now. `SEEING_MACHINE=off` in the site's settings turns the
   server's eye off at once. Everyone (answer 1) makes a complaint likelier than a few people would.
5. **Scripts from the start** (answer 7) make the server's eye a much bigger thing to lock down, and more of each site's own
   requests go out from your house.
6. **Phishing flags.** Pages only ever exist inside a signed-in person's frame. No address shows somebody else's page by
   itself, nothing is indexed, and sign-in pages are never shown.
7. **Ads and trackers are refused** in every lens: some sites' terms object, and some will ask for it to be switched off.
8. **It will not work everywhere.** The two eyes have a published table of what works (Phase 2), and a refusal says why.
9. **Upload.** Pictures pass through the tunnel (about 54 Mbit/s up, shared with everything). Video and sound never do.

## What exists, and what it is called here
- **Page and module:** `app/lib/ui/modules.ts` (a new `browser` key), `SiteWindow` with `fill`, as READ and BEATBOX use.
- **No taskbar, Start menu or desktop icon exists** (removed 2026-11-14), so none are made; the module key is the launcher.
- **Room:** `playInMainRoom`, `addToMyQueue`, `useRoomKey`, `SplitKey`, `recognizeLink`, `queueRefusal`, `probeVideoLink`.
- **Guarded fetch:** `app/lib/web/safe-fetch.ts`. It has no any-site mode and no check of what a name resolves to, because
  every caller has a list of hosts. Both are added there, beside the existing functions, whose behaviour doesn't change.
- **Tags:** "Tag Station" is DISCOVER now, a read-only map. Captures use the forum's tag words (`tag-vocabulary.ts`).
- **Search:** `SearchWindow` gets a PAGES group. **Forum:** a new anchor kind `page`. **Letters and recommendations:** a new
  kind `page` beside `link`.
- **Don't exist:** friends lists, third-party modules, a plug-in system, notes on web pages. The module's own boundaries are
  kept clean so they can come later; none are invented here.
- **History:** `user_plays` is for things played. Pages get a table of their own.

## The look: the site's, not Windows 95's
Luke's text describes teal, navy, grey and bevels. The site dropped those (docs/design.md, "Gnorp windows"), so BROWSER uses
the real look: tokens only, bracket keys, flat sections, 13px and up, instant feedback, no easing. The diagnostic feel comes
from the status line, the lenses and density, not bevels. Code draws no icons; the keys are words and text glyphs.

```
——— THE SEEING MACHINE ————————————————————————————————————————————————
[ WIKIPEDIA × ] [ BBC NEWS × ] [ + ]                                     tabs
◄ ► ↻ ■  [ https://en.wikipedia.org/wiki/Steve_Mann            ] [ GO ]
LENS: [ STANDARD ][ READER ][ WATCHERS ][ X-RAY ][ LOW-FI ][ DYE ] [ SEAM ][ LOUPE ]
MEDIA 2   [ KEEP PAGE ]   [ PAGE ]   [ SCAN ]   1998 ◄━━●━━► NOW   [ OPEN SOURCE ]
┌────────────────────────────────────────────────────────────────────────┐
│ the page                                                               │
└────────────────────────────────────────────────────────────────────────┘
DOCUMENT RECONSTRUCTED · SERVER EYE · 31 FILES · 14 REFUSED · LENS: READER
```
- **Tabs** (answer 4): up to 8, kept on the account with history; only the one in front keeps its page running, and coming
  back to BROWSER opens them again where they were. A page walked away from is reloaded, not kept alive.
- **The address is never sent to our server in a URL.** `/browser#see=<address>` (the part after # stays in the browser), and
  the page is asked for in a request's body. Nobody's reading lands in Cloudflare's or the site's logs that way.
- **Back and forward** here are the tab's own. The site's `◄ ►` (the undo trail) do not record pages read.
- **The status line** shows real steps only: `ACQUIRING SOURCE`, `PARSING DOCUMENT STRUCTURE`, `EXTRACTING MEDIA REFERENCES`,
  `APPLYING LENS: READER`, `DOCUMENT RECONSTRUCTED`, `SOURCE REFUSED: <why>`, `MEDIA SOURCE DETECTED`. No invented telemetry.
- **An empty tab** shows the address box, your recent captures and `[ SCAN ]`.
- Desktop first; no sideways scroll at 390.

## Themes (answer 5), all 18
| Part | What it wears |
| --- | --- |
| Window, keys, tabs, status line | tokens, like every window |
| STANDARD | nothing: the page as its makers sent it |
| READER | your theme's paper, ink, accent and links, or the book reader's `reader-light`, `-dark`, `-sepia` papers; site font or the page's; the reader's text-size keys |
| WATCHERS | names in the ink, refused ones on Rose chips, as faults are |
| X-RAY | outlines in the accent inks by kind (words, pictures, frames, scripts, links), labels in `text-label` |
| LOW-FI | palettes from existing dyes only: the theme's own, MONO (ink and paper), TERMINAL (Emerald on Black), AMBER, 1-BIT |
| THEME DYE (xiv) | every colour on the page moved to the nearest of your theme's dyes, keeping light and dark apart; pictures dithered to them |
| GLASS (xv) | the page's background clear so FLUID, SAND or the sea shows behind; each line of words keeps a solid strip of the window colour |
- The frame is told the theme as values read from `themes.ts` (`postMessage`); changing theme re-dresses an open page without
  reloading it. A new theme needs no work here.
- Words the lens colours must read 4.5:1 on every theme: a check walks all 18, as `check-themes` does. STANDARD is exempt.
- LOW-FI's scanlines and flicker are steps, never easing, and stop under `prefers-reduced-motion`.

## The two eyes
One interface (`SeeingEngine`: open, stop, a document or a refusal, the media it found, the watchers it refused). A lens never
knows which eye is in use.

### SERVER EYE: nothing to install, no sign-ins
1. The page asks `/api/see/open` with the reader's sign-in token and the address in the body. Token checked first
   (backend.md), then their limits.
2. **The guarded fetch**, a new any-site mode in `safe-fetch.ts`: http or https, ports 80 and 443, no user names in the
   address; the name looked up by a resolver that refuses known malware and phishing (answer 16; 1.1.1.2, its choice checked
   at build); **every** address it resolves to must be public; the connection goes to that same checked address (undici
   `Agent` with its own `lookup`, so a name can't change its mind between check and use); the same on every redirect; the
   site's own hosts refused. Refused ranges include loopback, 10/8, 172.16/12, 192.168/16, 169.254/16, 100.64/10
   (Tailscale), 0/8, multicast, IPv6 loopback, ULA, link-local, mapped and NAT64 forms, and the house's own public address.
   No cookies, no Authorization, no Referer, no header of ours but a plain user agent. 15 s, 8 MB a page, 5 redirects.
3. **The rewriter**: a real HTML parser (`parse5`, a new small dependency) and postcss for styles. Links become hook clicks;
   pictures, styles, fonts and scripts become signed asset addresses; `base`, `meta refresh`, the page's own CSP and
   service-worker registration go; known ad servers and trackers are refused, noted for WATCHERS, and their boxes marked for
   BILLBOARD. Text encodings other than UTF-8 are converted. A PDF or EPUB is offered to READ instead.
4. **Signed assets**: the frame can't send a sign-in token, so every asset address carries a signature over the address, the
   person and an expiry (one hour). No signature, no fetch: it is never an open proxy. Types allowed: pictures, CSS, fonts,
   scripts, JSON and text for a script's own requests. Never HTML as a document, never video or sound. `nosniff`, and SVG
   with a sandbox policy. Served from **`see.debaser.site`**, its own hostname (one tunnel rule and one DNS record: Luke's OK
   when it's built).
5. **The frame**: `sandbox="allow-scripts"`, never `allow-same-origin`, never top-navigation, popups or downloads. The
   document is handed over as `srcdoc`, so the page has no origin: no cookies, no storage, no way to our session. Its CSP
   allows our asset host only. Our small hook (a nonce) speaks by `postMessage`, which the page accepts from that frame's
   window only and treats as hostile.
6. **Scripts on** (answer 7): the hook gives the page in-memory storage and passes its `fetch`/XHR to the parent, which asks
   for them under the same checks. Workers, service workers, WebSockets and WebRTC are refused, and counted on the status
   line as `REMOTE SCRIPT RESTRICTED`. `[ SCRIPTS OFF ]` on the PAGE panel switches a site's scripts off.
7. **Forms**: GET searches work. Password boxes are dead and say so; other forms open the source instead.
8. **Limits, to start**: 400 pages a day and 60 a minute per person, 200 files a page, 6 fetches at once per person and 40 for
   the whole site, 256 MB of short-lived memory cache, nothing on disk. They sit in one file.
9. **Off switch**: `SEEING_MACHINE=off`. The outgoing route is one setting too (`SEEING_EXIT`, `direct` today: home), so the
   move to his own server changes a line.

### OWN EYE: the extension (D1)
- A Manifest V3 extension for Chrome and Edge, its own folder `extension/`. It acts only on sites the reader adds with a press
  (optional permissions asked one site at a time), and talks only to `https://debaser.site`.
- **A day's trial first**, before anything else is built, on the test list, signed in: which sites show and stay signed in
  - (a) inside BROWSER's tab (the extension lifts the site's no-framing header, for frames made by debaser.site only);
  - (b) in a normal tab beside it, with the lenses drawn on that tab and the machine in Chrome's side panel.
  Not known yet: cross-site cookie rules often sign a framed page out, so (a) may fail on many sites. (b) works wherever the
  site works. The result is a table Luke reads before choosing how OWN EYE opens.
- **Sign-in always happens on the real site in a real browser window**, never in a frame and never through SERVER. Google's,
  banks', payment and other sign-in hosts are on a never-framed list, because lifting a no-framing header removes that
  site's protection against disguised clicks.
- The extension never reads passwords or cookies, and sends the site only what the reader presses: a media item, a capture.
- Pages here are fetched by the reader's own browser, so sites see the reader's address (answer 2 was about the server's eye).

## Lenses
`app/lib/seeing/lenses/`: one file each, a registry, and nothing about one lens in another. A lens is any of: a change to the
document, a stylesheet, an overlay, its settings and its theme part. Switching is instant and needs no refetch. Per-site memory
(xvi) is a registry setting.
- **01 STANDARD**, **02 READER** (main text, pictures, reading order; our own extraction over the parsed document),
  **03 LOW-FI**, **04 X-RAY** (outlines, a tree, and a panel for the element you point at), **05 CUSTOM** (your own recipe from
  building blocks: text only, pictures only, links only, invert, mono, high contrast, hide, recolour; saved, shared as a
  recipe, never as code).
- **WATCHERS** (i): who was on the page, by company where known, and what was refused. Facts about the page, never about people.

## Every idea, and where it lands (answer 8)
| # | Idea | What you do | Phase |
| --- | --- | --- | --- |
| i | WATCHERS | the lens above | 2 |
| ii | SEAM | drag a line; a lens each side | 3 |
| iii | LOUPE | a box under the pointer in another lens, or the same words at 2x, 3x, 4x | 3 |
| iv | ERASE | point, press, gone; remembered for that site; one key brings everything back | 3 |
| v | BILLBOARD | STREAM ART where ads were (saved, not hidden pieces; a press opens the piece) | 2 |
| vi | TIME DIAL | a year; the Internet Archive's copy nearest it, through the same eye. Also offered when a site refuses | 3 |
| vii | SCAN | a random page of the small, old web, from public lists; a press marks it good or tunes on | 3 |
| viii | SEE key | `[ SEE ]` beside outside links in posts, comms, letters and MEDIA's reading rows | 4 |
| ix | TRAIL | your own walk as a map in DISCOVER's style, from your private history | 5 |
| x | SEEN TOGETHER | a page on your Room's screen, each person in their own lens; the host's scrolling leads | 6 |
| xi | MARGINALIA | a note on a passage (300 characters), shown to people who open that page here | 6 |
| xii | GRAFFITI | the Room's CANVAS over a page; a saved drawing keeps the page's address | 6 |
| xiii | SONIFY | a page's structure as a BEATBOX loop: headings the beat, links the notes | 6 |
| xiv | THEME DYE | the lens above | 3 |
| xv | GLASS | the lens above | 3 |
| xvi | SITE MEMORY | each site remembers its lens | 3 |

## Media to the Room
- **Found** in the document (video, audio, sources, `og:video`, oEmbed, JSON-LD, known embeds, links to media files) and, while
  scripts run, by watching the page change. The tray (`MEDIA 2`) lists title, site, kind, length when the page says it, and
  what can be done. Never counts, ratings or views.
- Each one is `[ ▶ PLAY IN ROOM │ + QUEUE ]`, the existing halves: your room, or the room you're in by its own rules.
- **The ladder** ("ideally find a way"), the first rung that works:
  1. a platform the Room knows (YouTube, Vimeo, Twitch, a media server): its own player;
  2. a direct https video, sound or stream file (`recognizeLink`), proved by `probeVideoLink` in this browser;
  3. the page's own declared player (oEmbed, `og:video`): framed in the Room in a sandbox, not in step with others, and marked
     `NOT IN STEP`. Today `queueRefusal` frames nothing unlisted; this is a new, separately marked kind, and the first player
     from a new host asks the host of the room to allow it;
  4. cast the tab: the browser's own "share this tab" into the Room, through SCREENS' room sharing (its relay key is still
     waiting on Luke). Protected video comes out black: the browser's rule, and nothing here gets round it;
  5. plays in the page only, saying why.
- Never shown as captured when it isn't. Blob addresses, encrypted streams and signed-in streams are not extracted.
- **Where it came from** is kept: the page's address and title, the media's, and when.

## Captures (Phase 5)
- `[ KEEP PAGE ]`: address, title, description, site, picture, language, date, your tags and note, up to 20 quotes (300
  characters), and **a full copy** (answer 11): the READER form plus the cleaned page, no scripts, no forms, no frames,
  pictures shrunk, 10 MB at most. Shown only in the sandboxed frame, with the source's link on top; `noindex`. `[ KEEP A COPY
  AT ARCHIVE.ORG ]` is offered too, and only on that press.
- **Everyone sees it straight away** (answer 12), as D4 says. The key says `EVERYONE WILL SEE THIS` beside it.
- **A private page can't leak**: the copy is always made by the server's own signed-out fetch, never from what your signed-in
  browser sees. If the signed-out page differs, you get a card only, private to you. This is fixed.
- A capture's owner deletes it; anybody can REPORT it (the moderation that exists); a moderator hides it. A takedown address is
  written on the copy.
- **Goes to** (answer 13) Ctrl+K, letters, forum (`page` anchor, TALKED ABOUT IN works at once), recommendations; then MEDIA's
  feed as a PAGES lane and DISCOVER by its tags (never Claude's words without a separate OK).
- History (answer 15): private to the account, one key to clear it, 90 days.

### Database changes (none now; each needs Luke's typed OK when built)
In plain English: **one small migration at Phase 2 and one at Phase 5**, adding tables and widening two lists. Nothing is changed or deleted.
- `seen_pages` (the card; everyone reads, its owner adds and deletes, moderators hide), `seen_page_copies` (the copy's words for
  search and where its file sits), `seen_notes` (quotes and MARGINALIA), `seen_media` (media found on it), `browse_tabs` and
  `browse_history` (owner only). A private storage bucket `seen` on `I:\DEBASER\files`.
- `page` added to the forum's anchor kinds and to letters' and recommendations' kinds.
- A small one at Phase 2: `browse_log` (account, site name, time; written by the server only, read by Luke only, kept forever, D3).
Row Level Security on all; stream guests make and read nothing. Mock and Supabase repositories both.
Until Phase 5, tabs and history live in the browser only.

## Phases
Each is its own build session, ends live and proved, and stops for Luke to look.
1. **The shell.** Module, page, tabs, address bar, ◄ ► ↻ ■, lens keys, status line, a built-in test page. Off the bar until
   ticked, WIP tag. No fetching. Themes proved on all 18.
2. **The server's eye**, seen by Luke only at first: guarded fetch, rewriter, frame, signed assets, scripts on, READER,
   WATCHERS, BILLBOARD, limits, off switch, the table of what works. Opens to everyone (D2) only after the attack list passes
   and Luke has looked. **1 and 2 are the smallest first build.**
   - 2b, beside it: the extension's trial day (D1). Its result is a table, not a product.
3. **Lenses**: X-RAY, LOW-FI, THEME DYE, GLASS, CUSTOM, SEAM, LOUPE, ERASE, SITE MEMORY, TIME DIAL, SCAN.
4. **OWN EYE and the Room**: the extension for real, the media tray, rungs 1 to 3, the SEE key. (Rung 4 waits for SCREENS.)
5. **Captures** and their places, history and tabs on the account, TRAIL. The migration.
6. **Together**: SEEN TOGETHER, MARGINALIA, GRAFFITI, SONIFY, rung 4, MEDIA's PAGES lane, DISCOVER. Polish throughout.

## Out of scope
Logins through the server; a Chromium on SERVER; passing video or sound through the server; saving video;
getting round DRM, paywalls, CAPTCHAs or bot checks; scraping pages for the feed (a page is read because a person asked for
it); phone design; a plug-in system; friends lists; anybody's own lens code running.

## How each phase is proved
Local dev server and mock data first; the live site only to confirm it is there.
- **The attack list** (`Temp/check-see-attack.cjs`, offline with a fake resolver and fetch, each case watched failing with its
  guard removed): every refused range in every spelling (decimal, octal, hex, mapped IPv6); a name that resolves public then
  private; a redirect to loopback, the LAN, Tailscale and the site's own hosts; ports; user names in an address; oversize,
  slow and endless bodies; compression bombs; wrong types; HTML served as a picture; an SVG with a script; an altered, expired
  or another person's signature; no token; the off switch. Then once for real, on SERVER, with a test page that points at each
  service listed under Risk 1: every one refused, and the log of each shows no visit.
- **The frame** (`scripts/drive-see.cjs`, a local hostile page): can't read cookies, storage or the parent; can't navigate the
  top, open windows, download, or reach any host but ours; forged messages ignored.
- **The rewriter and lenses**: checks on saved pages (a news page, a Shift_JIS page, broken HTML, a 5 MB page), and a contrast
  walk of READER, WATCHERS, X-RAY and GLASS over all 18 themes.
- **The table of what works**: a fixed list (Wikipedia, BBC News, the Guardian, Hacker News, GitHub, archive.org, old Reddit, a
  one-page app, a paywalled paper, YouTube, X, Instagram, a 404, a redirect, a PDF), both eyes, recorded in
  `docs/seeing-machine.md`.
- **Room**: each rung with a local page, through the existing queue checks, `drive-room`-style.
- **Captures**: two test accounts; the private-page rule proved with a page that differs when signed in; visitors and stream
  guests refused what they should be; a hide and a delete.
- **The house loop** each time: verify, `checks:changed`, capture and audit (visual), `code-reviewer` on the diff, and
  `/security-review` before Phase 2 opens to anybody but Luke.
- **Can't be proved here**: how Cloudflare or a site will react over time; Google's behaviour with people's own accounts (no
  one signs in for them).

## Files (proposed)
`app/browser/page.tsx`, `app/components/seeing/*` (page, toolbar, tabs, viewport, status, tray), `app/lib/seeing/*` (engine,
history, lens registry, media finder, Room hand-over, capture, mock and Supabase repositories), `app/lib/seeing/server/*`
(rewriter, signing, blocklists; never imported by the browser, held by a check as `check-web-types` does), `app/api/see/*`,
`extension/` (Phase 4), and a small addition to `safe-fetch.ts` and `modules.ts`. CLAUDE.md gets a short BROWSER section with
Phase 2, saying that a page is fetched because a reader asked, and that this isn't scraping for the feed.
