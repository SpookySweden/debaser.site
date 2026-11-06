# What to get from each friend

One copy per friend. Their side of it, with the details, is `docs/media-server-setup.md`: send them that.

**1. NAME for their button:** ______________________ (capitals, 30 letters at most)

**2. ADDRESS of their server:** `https://`______________________ (nothing after the name)

**3. LIST FILE:** is it at `/debaser/list.json`?  YES / NO, it's at: ______________________

**4. PLAYER LINKS:** are they these? ( `157336`, `1399`, `1`, `2` are examples )

| | The usual link | Theirs, if different |
|---|---|---|
| A film | `/debaser/play/movie/157336` | |
| An episode (show 1399, season 1, episode 2) | `/debaser/play/tv/1399/1/2` | |
| A whole show | `/debaser/play/tv/1399` | or NONE |
| Their own video | `/debaser/play/item/my-film` | or NONE |

**5. ASK THEM TO CONFIRM:**

- [ ] It is a server they run, not a public film-lookup site.
- [ ] Each show in their list is either one line per episode, or one line for the whole show (their player then needs to answer every episode).
- [ ] Their player pages send the frame line in step 4 of `docs/media-server-setup.md`.
- [ ] Their player starts inside a sandbox. If it won't, tick here and the sandbox gets turned off for that server alone: ___

**Then:** give this to Claude, or put it in the Debaser Servers program on the desktop. The program's TEST button checks the list and the
players before anything is saved. The friend's titles show on /media after the next hourly update.
