PROFILE PICTURES
================

Drawings in here are the public profile pictures accounts can pick.

  avatar-default.png                          the DEFAULT PFP: the house picture
                                              shown on posts that belong to the
                                              site itself rather than to a person,
                                              e.g. a thread a concept sheet's
                                              [ COMMENT ] box opened
                                              (app/lib/forum/site-author.ts),
                                              drawn square at 256x256

  uploads/                                    pictures filed through the
                                              "CUSTOMISE PUBLIC PROFILE" console
                                              (POST /api/profile/avatar)

The fixed `avatar-slot-NN.png` files are gone. A profile filed against one still
shows it, because a version stores whatever `src` it was filed with, but nobody
can pick a slot any more and the files are not part of the picker.

Nothing in this folder is generated: every file is a hand-drawn PNG (or JPG /
WEBP / GIF for uploads) added by hand. While the default file is missing the
profile page shows "[ ARTWORK FILE NOT FOUND ]" naming the path it wanted, so an
undrawn house picture is obvious rather than a broken image.

Uploads, and which of them are committed
----------------------------------------
`uploads/` is written by the app itself, so it shows up in `git status`. Commit a
file when the picture belongs on the deployed site - and note which mode wrote it
(app/lib/profile/avatar-upload.ts):

- On Supabase, an upload goes to the public `avatars` storage bucket and **nothing
  lands here at all**. A deployed site therefore never writes into this folder.
- On the mock store (local development), the file lands here and the mock profile
  in that browser's own storage points at it.

`mock-user-...png` is a mock-mode upload that is committed for that reason and
for no other: it is the one picture the local mock store has filed, and deleting
it would leave a local profile pointing at a 404. It is not part of the site's own
artwork and nothing but a mock profile ever asks for it.
