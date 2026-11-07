# Privacy plan: Luke's decisions (2026-11-05)

The plan is Luke's Claude Doc "debaser.site — Privacy by Default Plan", https://claude.ai/artifact/XQBnZspNp53HDUD7mgm6HH.
It lists 13 decisions. Luke said to take its recommendations and ask him the big ones, so these are settled:

| # | Decision | Answer | How it was settled |
|---|---|---|---|
| 1 | Private room with no password | The link is the key | Plan's recommendation |
| 2 | Latecomers | Anyone who joins sees the whole stream | Plan's recommendation |
| 3 | Removed people | They lose access to that stream's record too | Plan's recommendation |
| 4 | Directory for new accounts | Listed, with listening and comments off, and the online lamp **on** (Luke changed this on 2026-11-07: "if that is due to a privacy default, change the default"; it was off until then) | Plan's recommendation, then Luke's |
| 5 | Names on the board for signed-out visitors and search engines | ANON tags | **Luke chose** |
| 6 | Guests | Can join, talk, draw and reply; starting a stream or board thread needs an account | Plan's recommendation |
| 7 | Idle guests after 30 days | The guest goes, its posts stay as FORMER GUEST | Plan's recommendation |
| 8 | Admin and private rooms | **No, not even admin.** This differs from the plan's recommendation | **Luke chose** |
| 9 | OFF THE RECORD rooms | Later, not in this build | Plan's recommendation |
| 10 | The 13 existing accounts | Keep their settings and show the PRIVACY tab once | **Luke chose** |
| 11 | Bot check on guests | Cloudflare Turnstile | Plan's recommendation |
| 12 | Canvas for outsiders | No picture, just the stroke count | Plan's recommendation |
| 13 | Length of the bars | Three sizes: short, medium, long | Plan's recommendation |

## What decision 8 means when building
- No account gets a way into a private room's chat, queue, canvas or record through the site, the house admin included.
  Check any existing admin paths in rules and pages, not only the new ones.
- The PRIVACY tab must not overclaim. Whoever runs the database can still read its tables directly, as `npm run db` does, so
  word it as "no account on the site can read a private room", not "nobody can ever".
- A report of abuse inside a private room can't be checked on the site. The plan's moderation wording needs to cover this:
  removal and bans still work on people, without reading what they said.

## Other standing answers
- `[ WATCH IN ROOM ]` waits for private streams (`SPEC-floating-player.md`, part 3).
- Questions from sessions go to the main session, not to Luke directly, and are answered from the spec where it settles them.
