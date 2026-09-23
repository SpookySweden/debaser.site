MUSIC ARCHIVE
=============

The tracks on /music live here, as plain files, added by hand exactly the way the
drawings are: nothing on this site generates audio, and the page never guesses at a
track it cannot find.

Naming
------
assets/audio/<id>.mp3     one file per track in the catalogue
                          (app/lib/projects/tracks.ts)

The id is built from the release, not from the track's name, so retitling a track
never moves the file it plays:

  <artist>-<album>-<number>     e.g. sleep-static-tape-deck-summer-01.mp3

MP3 is the default. M4A, OGG, WAV and FLAC are served too - the asset route in
app/assets/[...path]/route.ts maps the extension to its content type, and anything
not on that list is refused with a 400 rather than guessed at.

How a track reads
-----------------
One convention, everywhere - the directory, the player's display, and a post a track
has been attached to:

  [TRACK TITLE] - [ALBUM NAME] - [ARTIST NAME]

Filing a track
--------------
Two ways, and they end in the same place - the shelf the player reads:

1. **From the page** (`/music`, `[ NEW FILE ]`): any signed-in account may pick an audio file, give
   it a name, choose the folder it is filed in (or type a new folder), and tag it. The audio goes
   to the `mp3` bucket when Supabase is configured, and into this folder through
   `/api/music/upload` when the site is running on its own stores. `[ NEW FOLDER ]`, and the
   `[ + FILE ]` / `[ + FOLDER ]` buttons on a folder row, make the folders.
2. **By hand**, for the archive's own catalogue: save the audio here as
   `assets/audio/<artist>-<album>-<number>.mp3`, then add the release to `RELEASES` in
   `app/lib/projects/tracks.ts` with its artist, year, tags and track list.

A track reads as `[TRACK TITLE] - [ALBUM NAME] - [ARTIST NAME]` in both cases, because in this
archive a file's name is where it is: the parts after the title are the folders it sits in. A row
whose file is not there yet still lists, and pressing play answers with the player's own words -
`THAT FILE COULD NOT BE PLAYED :: <path>` - which is the audio half of the
"[ ARTWORK FILE NOT FOUND ]" notice the drawings use.

Keep the catalogue honest
-------------------------
Set `length` to the real running time once the audio is filed; the listing is also the sleeve
notes, and a placeholder "--:--" next to a finished track reads as a missing file. A track filed
from the page has its running time read off the file as it is filed, so it needs nothing typed in.
