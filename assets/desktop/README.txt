The desktop itself: the one drawing that is behind everything else.

  desktop-tile.png     128x128, drawn at 128x128 (x1) - it repeats, so the
                       drawing IS its repeat, and a bigger file would change the
                       pattern's scale rather than sharpen it

  taskbar-strip.png    48x48, drawn at 48x48 (x2) and shown 24px tall
                       (the 9-slice margins are in app/lib/ui/art/slots.ts)

The desktop tile is the only drawing on the site with no edge to hide: it is
`background-repeat: repeat` from wall to wall, so the left column of pixels has to
continue into the right one and the top row into the bottom. A tile that does not
wrap shows a grid of seams, and a grid of seams is the single most obvious way for
a tile to look wrong.

Both files are optional. Until they are drawn, `.desktop-tile` lays down a CSS
dither and `.taskbar` draws its strip with a repeating linear-gradient - so the
desktop is finished-looking now and the drawings are an upgrade, not a fix.

The sizes, and the one rule that keeps a drawing crisp
------------------------------------------------------
    natural = shown x k        (k a whole number)

`shown` is the box in CSS pixels and `k` is the whole-number zoom. `npm run art`
reads the registry in `app/lib/ui/art/slots.ts` and fails on a file that is not
exactly `shown x k`, because a drawing shown at a fractional ratio resamples and
every line in it goes soft.
