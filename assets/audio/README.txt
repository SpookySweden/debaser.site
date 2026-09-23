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
1. Save the audio here as assets/audio/<id>.mp3, using the id the catalogue derives.
2. Add the release to RELEASES in app/lib/projects/tracks.ts: its artist, year, how
   it sounds, and its track list with a running time each.
3. /music lists it under its artist and release; /projects/debaser counts it.

Until the file exists the row still lists - and pressing play answers with the
player's own words, "[ THAT FILE COULD NOT BE PLAYED :: <path> ]", which is the audio
half of the "[ ARTWORK FILE NOT FOUND ]" notice the drawings use. Nothing else has to
change when the file lands: the player picks it up on the next load.

Keep the catalogue honest
-------------------------
Set `length` to the real running time once the audio is filed; the listing is also the
sleeve notes, and a placeholder "--:--" next to a finished track reads as a missing
file.
