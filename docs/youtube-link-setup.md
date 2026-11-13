# Switching on YOUR YOUTUBE (Luke's steps)

MEDIA can lean towards what you watch on YouTube once Google allows it. The code is built and switched off.
These are the steps only you can do. Claude never signs in to these pages or touches a key.

**What it can and can't do.** Google has no way to hand over your real YouTube homepage. The only route to that is your
YouTube login cookies, and the site will never hold those. What it reads instead, read-only: the channels you subscribe
to, their newest uploads, your liked videos, your playlists' names, and the topics YouTube files your channels under
(Music, Film, Gaming...). No view or like counts. Google's permission is used for one read and never stored.

## In Google Cloud (console.cloud.google.com)
Open the project that holds the site's Google sign-in.

1. **Turn on the YouTube API.** Menu > APIs & Services > Library. Search **YouTube Data API v3**. Press **ENABLE**.
2. **Add the permission.** Menu > Google Auth Platform (older screens: OAuth consent screen) > **Data Access** >
   **ADD OR REMOVE SCOPES**. Tick the one ending **`/auth/youtube.readonly`**. Press **Update**, then **Save**.
3. **Check the app's details.** Google Auth Platform > **Branding**: Home page `https://debaser.site`, a Privacy policy
   link to a page on the site, and `debaser.site` under Authorised domains. Save.
4. **Choose who can use it.** Google Auth Platform > **Audience**. Pick one:
   - **Testing** (quickest): under Test users, add each Google address that may link YouTube (up to 100).
     Google asks them again every 7 days.
   - **In production**: press **Publish**, then **Prepare for verification**. Google reviews it (it wants the privacy
     policy and a short screen video of pressing LINK YOUTUBE). Until it's verified, people see "Google hasn't verified
     this app" and have to press Advanced, then Go to debaser.site.

## In Supabase (supabase.com/dashboard)
Open the site's project.

5. **Let Google send people back to MEDIA.** Authentication > URL Configuration > **Redirect URLs** > Add URL:
   `https://debaser.site/media`. Save. (Google sign-in itself is already on; nothing else changes here.)

## Then
6. Tell Claude **"Google is done"**. Claude switches YOUR YOUTUBE on (a public setting, not a secret) and pushes it.
   On MEDIA, signed in, press **[ LINK YOUTUBE ]** once.

**Good to know.** Google allows 10,000 units a day; one read is about 30, so roughly 300 reads a day across everyone.
Google's permission lasts about an hour: within it MEDIA refreshes by itself on every visit; after it, MEDIA uses what it
read (kept in your browser for a week) and **[ REFRESH ]** asks Google again with one press.
