# Switching on YOUR YOUTUBE (Luke's steps)

MEDIA can lean towards what you watch on YouTube once Google allows it. The code is built and switched off.
These are the steps only you can do. Claude never signs in to these pages or touches a key.

**What it can and can't do.** Google has no way to hand over your real YouTube homepage. The only route to that is your
YouTube login cookies, and the site will never hold those. What it reads instead, read-only: the channels you subscribe
to, their newest uploads, your liked videos, your playlists' names, and the topics YouTube files your channels under
(Music, Film, Gaming...). No view or like counts. Google's permission is used for one read and never stored.

**The route that works today: Testing mode.** The site lives at `https://debaser-site.vercel.app`. Google only lets an app
be published (and verified) for a domain you can prove you own, and nobody but Vercel can prove they own `vercel.app`.
So: keep the Google app in **Testing** and add your own Google addresses as test users. That needs no privacy policy and
no review. Opening it to everyone later needs a domain of your own (and a privacy policy page, which the site does not
have yet).

## In Google Cloud (console.cloud.google.com)
Open the project that holds the site's Google sign-in.

1. **Turn on the YouTube API.** Menu > APIs & Services > Library. Search **YouTube Data API v3**. Press **ENABLE**.
2. **Add the permission.** Menu > Google Auth Platform (older screens: OAuth consent screen) > **Data Access** >
   **ADD OR REMOVE SCOPES**. Tick the one ending **`/auth/youtube.readonly`**. Press **Update**, then **Save**.
3. **Keep it in Testing and add yourself.** Google Auth Platform > **Audience**. Publishing status should say
   **Testing** (leave it). Under **Test users** press **ADD USERS** and add each Google address that may link YouTube
   (yours first; up to 100). Save. Google will show a "Google hasn't verified this app" screen on linking: press
   **Continue**. It also asks again every 7 days.
4. **Leave Branding as it is.** In Testing mode the home page, privacy policy and authorised domain fields are not needed.
   Don't add `vercel.app` as an authorised domain: Google refuses it.

## In Supabase (supabase.com/dashboard)
Open the site's project.

5. **Let Google send people back to MEDIA.** Authentication > URL Configuration > **Redirect URLs** > Add URL:
   `https://debaser-site.vercel.app/media`. Save. (Google sign-in itself is already on; nothing else changes here.)

## Then
6. Tell Claude **"Google is done"**. Claude switches YOUR YOUTUBE on (a public setting, not a secret) and pushes it.
   On MEDIA, signed in with a test-user Google address, press **[ LINK YOUTUBE ]** once.

## Later, to open it to everyone
Buy a domain, point it at the Vercel project (Vercel > Settings > Domains), prove it in Google Search Console, add a
privacy policy page to the site, then in Google Auth Platform fill in Branding with that domain and **Publish** >
**Prepare for verification** (Google reviews the YouTube permission; it wants the privacy policy and a short video of
LINK YOUTUBE). Add `https://<your domain>/media` to Supabase's Redirect URLs too.

**Good to know.** Google allows 10,000 units a day; one read is about 30, so roughly 300 reads a day across everyone.
Google's permission lasts about an hour: within it MEDIA refreshes by itself on every visit; after it, MEDIA uses what it
read (kept in your browser for a week, and the channels and topics on your account for 30 days) and **[ REFRESH ]** asks
Google again with one press.
