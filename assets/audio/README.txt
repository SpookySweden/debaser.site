MUSIC SHELF
===========

The tracks on /music live here, as plain files, added by hand exactly the way the
drawings are: nothing on this site generates audio, and the page never guesses at
a track it cannot find.

Naming
------
assets/audio/<id>.mp3     one file per entry in TRACKS (app/lib/projects/tracks.ts)

MP3 is the default. M4A, OGG, WAV and FLAC are served too - the asset route in
app/assets/[...path]/route.ts maps the extension to its content type, and anything
not on that list is refused with a 400 rather than guessed at.

Filing a track
--------------
1. Save the file here as assets/audio/<id>.mp3
2. Add one entry to TRACKS with its title, credit, kind and running time.
3. /music shows it with a player; /projects/debaser counts it.

Until the file exists the row prints "[ AWAITING /assets/audio/<id>.mp3 ]", which is
the audio half of the "[ ARTWORK FILE NOT FOUND ]" notice the drawings use. Nothing
else has to change when the file lands - the player picks it up on the next load.

Keep the manifest honest
------------------------
Set `length` to the real running time once the audio is filed; the track list is
also the sleeve notes, and a placeholder "--:--" next to a finished track reads as
a missing file.
