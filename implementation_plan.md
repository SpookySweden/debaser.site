# implementation_plan.md

**3D-to-2D Pixel Art Character Creator**
Target: `app/components/ProfileCustomiserWindow.tsx`

**Owner decisions taken as given:**
- **A panel**, not a third tab — appended to the `[ PICTURE, BIO & TAGS ]` tab body.
- **The asset rule is set aside for this feature** (see §6 for the two things still held to).

---

## 0. What was verified before planning

| Question | Finding | Consequence |
| --- | --- | --- |
| Where does the customiser live? | `ProfileCustomiserWindow.tsx`, a `PopoutWindow` opened from `/account`, with two tabs | Insertion is **inside tab 1's body**, not between the two tab buttons |
| Section order | Tab `profile`: **PICTURE** (273) → **THE TRACK** (295) → **NAME/BIO** (314) → **TAGS** (334) | The editor goes after `<ProfileTagsTab />` at line 346 |
| **Does the stack install?** | **Yes, checked against npm.** fiber **9.8.1** (`react >=19 <19.4`), drei **10.7.8** (`^19`), postprocessing **3.1.2** (`^19`), three **0.186.1**, `postprocessing` **6.39.5**, zustand **5.0.15** | Compatible with `react@19.2.8`. Six runtime deps, and `@react-three/postprocessing` needs `postprocessing` as a peer — one the brief did not name |
| Any WebGL today? | **None.** No canvas anywhere in `app/` | First GPU surface on the site |
| Window height | `PopoutWindow` caps its body at `max-h-[70vh]` + `overflow-y-auto` | A split-screen inside a scroller is the trap the RADI-OH caption paid three turns for — §1.5 |
| Is `/account` prerendered? | Yes, and it is in `qa-audit.cjs`'s `ROUTES` | A canvas that runs on the server breaks the build — §1.3 |

---

## 1. Phase 1 — Routing & UI Integration

1. **Install** `three`, `@types/three`, `@react-three/fiber@^9`, `@react-three/drei@^10`,
   `@react-three/postprocessing@^3`, `postprocessing`, `zustand`. **Checked first**, because if this
   fails the rest of the plan is fiction.
2. **`CharacterEditorPanel`** appended after `<ProfileTagsTab />` (line 346), before the tab body closes.
3. **Server guard** — `'use client'` plus `dynamic(..., { ssr: false })` for the canvas component.
   Three.js touches `window` at import, and `next build` and `qa-audit` both render `/account` with no GPU.
4. **Workspace** — flex row on `sm` and up, stacked on a phone: **left 50% FRONT** orthographic,
   **right 50% SIDE** orthographic, **sidebar** with the four layers and the rescaler. Chrome comes from
   `app/lib/ui/controls.ts` and the nine tokens.
5. **Height, deliberately** — an explicit height class rather than `flex-1`, with the surface
   `position: sticky` inside it, so scrolling the customiser does not scroll the model away and the canvas
   is not fighting the `70vh` box.
6. **Verify** — `verify`, `checks`, `capture` + `qa-audit`, `read /account`. The canvas is client-only, so
   the read proves the *container* is served and nothing more.

---

## 2. Phase 2 — Skeleton State

1. **`app/lib/character/skeleton.ts`** — `Joint { id, parentId, position, rotation, scale }` plus **pure
   functions only** (`addJoint`, `removeJoint`, `reparent`, `worldPosition`, `descendants`), with **no React
   and no Three.js types** — plain `{x,y,z}` triples, matching how `broadcast.ts` and `format.ts` keep
   arithmetic checkable without a browser.
   - **The structural decision that matters most:** the store holds *authoring data*, never objects. A
     `THREE.Vector3` in Zustand is a mutable object shared between renders; plain triples are what every
     other store here holds, and what a check can assert.
2. **`app/lib/character/store.ts`** — Zustand: joint map, active layer, selected joint, per-layer
   visibility, light azimuth/elevation.
3. **`app/lib/character/rig.ts`** — the brief's mapping: **Head → BoxGeometry**, **Torso → SphereGeometry**,
   **Limbs → ConeGeometry**. About a dozen joints. The mapping lives in a **`PART_OF_JOINT` table**, not in
   components, so Phase 4 has one source.
4. **`Temp/check-character.cjs`** — assert the tree operations, assert the rig's geometry per bone, and
   **prove each assertion fails** before trusting it.

---

## 3. Phase 3 — Layer Selection & Interaction Modes

1. **Four layers**, each row carrying **two independent controls** — a selection and an Eye. Collapsing them
   would make "look at the wireframe" require deselecting the layer you are editing.
2. **The Eye goes dark** with the `chrome` / `chrome-dark` pair — the tokens `AGENTS.md` says exist exactly
   for "an inactive title bar and a disabled plate". No invented grey.
3. **The mode is derived, never stored.** One `activeLayer`; a `useInteractionMode()` returning
   `'joints' | 'mass' | 'light' | 'none'`. Two stored facts can disagree; one derived fact cannot.
4. **Drags:** L1 moves a joint (**Front** = X/Y, **Side** = Z/Y — the constraint belongs to the *viewport*,
   passed into the handler rather than branched inside it); L2/L3 rescales mass; L4 moves the **directional
   light**.
5. **R3F pointer events** — its own raycasting with `setPointerCapture` and an `active` ref guarding the
   drag, so a fast pointer leaving the canvas does not strand a joint mid-move.

---

## 4. Phase 4 — Mass Mapping & the Rescaler

1. One component per primitive, reading the joint transform from the store and the geometry kind from the
   table, each inside a `<group>` at the joint so geometry rides the rig with no per-frame maths in React.
2. **Rescaler** — a range input plus readout for the selected joint, in `FIELD` style with
   `max-sm:min-h-11` (the QA audit counts tap targets). Scaling writes the joint's `scale`, so the store
   stays the single source.
3. **Pick sets follow the layer** — joints for L1, mass for L2/L3.
4. **Check:** the table covers every joint that should carry a primitive and none that should not; scaling a
   parent moves its descendants; a hidden layer renders nothing.

---

## 5. Phase 5 — The Shader Pipeline

1. **One `<Canvas>`, two `<View>`s** — as specified, and correct: two `<Canvas>` elements is two WebGL
   contexts, and browsers cap them low, mobile lower.
2. **Pixelation** — a `WebGLRenderTarget` at low internal resolution (~96x128 per viewport, tuned against
   the model) with `THREE.NearestFilter`, which is what makes it read as pixel art rather than blur.
3. **Outline** — a custom `Effect`, GLSL stored as a string in `app/lib/character/outline.ts` so it can be
   read and diffed, and so the check can assert it targets exactly one pixel rather than trusting a comment.
4. **Layers against the pipeline** — L4 active runs the composer; L1/L2/L3 bypass it, because the brief says
   L3 is *"without any pixelation post-processing"*. A hidden L4 does not run even when selected.
5. **`frameloop="demand"`** — invalidated on store writes and drags. Rendering 60fps of a static figure on
   every `/account` visit is a battery cost nobody asked for, and `demand` is hard to retrofit.

---

## 6. The asset rule — as ruled, with two things still held to

The owner has ruled that this feature may proceed. Two things are kept anyway, because they cost nothing and
keep a rule that governs everything else intact:

- **Never present the shader output as a replacement for the hand-drawn avatar.** It is a third artefact
  beside the uploaded picture, not a substitute; nothing in the profile's picture slot changes.
- **The editor's own chrome stays fully inside the palette and radius rules.** Panels, plates and the eye
  toggles: nine colours, 0px radius, checked by `check-surreal.cjs` like everything else.

That keeps a clear seam, so storing the 3D figure as a profile avatar later is a new decision rather than a
rule quietly eroded along the way.

---

## 7. Execution order and gates

| Phase | Builds | Ship gate |
| --- | --- | --- |
| 1 | Deps, panel, split-screen shell, sidebar | Nothing renders 3D yet; site not slower |
| 2 | Store, joint tree, default rig, pure ops | No GPU touched; still shippable |
| 3 | Four layers, Eye toggles, derived mode, drags | Editor usable for joints |
| 4 | Mass geometry, rescaler, pick sets | Figure editable end to end |
| 5 | View split, render target, outline, demand loop | Pixel output live |

Each phase ends per `AGENTS.md`: `verify` -> `checks` -> `capture` + `qa-audit` -> commit -> push -> `read`,
then a plain report of what was checked and what was not.

**The limit stated every time:** the agent cannot see pixels, click, hover or drag. From Phase 3 on, what can
be proved is that the code is wired and the checks pass - **not that the figure looks like anything**, and
not that a drag feels right.
