# Privacy, phase 1: the PRIVACY tab and new-account defaults

Settled from Luke's privacy plan and `SPEC-privacy-decisions.md` (decisions 4 and 10), without an interview, as he asked.

## What he will see
- **/account gets two tabs:** `[ ACCOUNT ]`, which is everything the page holds today, and `[ PRIVACY ]`, in large type.
  `/account?tab=privacy` opens the second one.
- **The PRIVACY tab's switches**, each saved the moment it is pressed:
  - ONLINE LAMP: other people see your lamp and when you were last here, and your `[ TV ]` key while you are in a stream.
  - MY LISTENING: your plays count, and your face can show beside songs in other people's picks.
  - PROFILE COMMENTS, PICTURE COMMENTS, TRACK COMMENTS.
  - TAGS.
- **One line about the country flag:** it shows only to people who are signed in, and is set in EDIT PROFILE.
- **Seen once:** the first time an account is signed in after this, a PRIVACY window opens beside the page, once per account, on any
  device. It holds the same switches and one main key:
  - everything off (a new account): `[ KEEP IT PRIVATE ]`;
  - something on (an existing account): `[ KEEP THESE SETTINGS ]`, plus `[ TURN EVERYTHING OFF ]`.
  Pressing a main key or closing the window counts as seen. Saying "KEEP IT PRIVATE" over switches that are on would be untrue.

## New accounts and existing accounts
- **New accounts:** listed in the directory (decision 4), with listening and all three comment switches off, and since 2026-11-07 the lamp and `[ TV ]` on (Luke's change; they were off before). Tags were
  already off. The database's column defaults do this, so an account made any way gets them.
- **Existing accounts keep every setting (decision 10)** and see the window once. The test accounts are marked as having seen it, so
  it does not sit on top of every check and drive.

## What the lamp switch does
- **Off:** others get no lamp, no last-seen time and no `[ TV ]` key for you, enforced by the database: your stamp's row cannot be read
  or heard by anyone else, and your tab does not announce itself on the who-is-online channel.
- You still see your own lamp, and you still hear everyone else's.
- You still show in a stream room you are in, because the people there can see you.
- **A person with the lamp off can still be challenged to a game.** Refusing would say they are offline, which may not be true.

## Not switches yet
Two more columns go in now so accounts made from today get the right value, but they have no switch until they do something (phase 5):
- SHOW MY NAME TO VISITORS: on for existing accounts, off for new ones.
- CREDIT ME IN STREAM ART: on for everybody.
A switch that changed nothing would be a false promise.

## Also fixed here
Since phase 0, a signed-out visitor opening a profile saw `CHECKING...` and a red lamp forever. They now see neither, and nor does anyone
looking at a person whose lamp is off.

## Both stores
The mock store has the same switches and defaults, leaves lamp-off people out of its presence list, and remembers the window was seen.

## Proof
- The defaults read back from the database, including from an account created inside a transaction that is then undone.
- A test account with the lamp off: another account gets no row and hears no heartbeat; with it on, it does.
- Screenshots of the tab at desktop and phone width; `npm run audit` passes.
- `npm run verify`, the whole `npm run checks`, the code review, and `npm run read` on the live site.
