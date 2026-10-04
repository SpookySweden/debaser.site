The faces of the controls: every plate, field and well a reader presses or types into.

  plate.png              48x48  drawn at 48x48 (x2), shown 24x24
  plate-hover.png        48x48  " and it must read as the SAME plate, lit
  plate-pressed.png      48x48  " the bevel turns inside out - that inversion is the press
  plate-disabled.png     48x48  " it must not look pressable; that is its whole job
  plate-accent.png       48x48  " the verb that reaches out of a window onto the board
  field.png              48x48  " sunken, and the writing sits on plain White
  panel.png              48x48  " a raised plinth with a sunken well inside it
  chip.png               44x44  " shown 22x22 - one track, one tag, one shelf label
  title-bar-button.png   36x36  " shown 18x18 - the key on a title bar
  sprite-slot.png        48x48  " the field a hand-drawn sprite reads against

Every file here is 9-sliced - four corners drawn once, edges and middle stretched -
so draw them as a *set*. Six plates that disagree about where the bevel sits, or
how thick it is, do not read as six states of one button; they read as six buttons.
The states are the whole point: resting, hover, pressed and disabled have to be
recognisably the same object.

The margins are in `app/lib/ui/art/slots.ts`, in drawn pixels, and `npm run art`
fails if a margin reaches or passes the edge of the drawing.

No file here is required. Until one is drawn, the control wears exactly what it
wears today: the Tailwind bevels and fills in `app/lib/ui/controls.ts`.

The sizes, and the one rule that keeps a drawing crisp
------------------------------------------------------
    natural = shown x k        (k a whole number)

`npm run art` reads the registry in `app/lib/ui/art/slots.ts` and fails on a file
that is not exactly `shown x k`, because a drawing shown at a fractional ratio
resamples and every line in it goes soft.
