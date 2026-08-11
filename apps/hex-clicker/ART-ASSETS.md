# Hex Clicker — art asset brief

Everything an artist needs to know to make art for this game, and the complete
list of what there is to make.

**Start here, because it is unusual:** the game currently ships **zero image
files**. There is no `assets/` folder, no sprite sheet, no PNG, no texture. Every
pixel on screen today is one of four things — inline SVG paths in the markup,
`<canvas>` draw calls, CSS gradients, or a **system emoji**. So this is not a
"replace the placeholder PNGs" job. It is a job of authoring vector art into a
running rig, and most of the constraints below exist because the code animates
the art rather than merely displaying it.

The one existing standalone art file is `prototypes/hex-cat.svg`, which is Hex's
Figma round-trip source. Everything else lives inline.

---

## 0. The shopping list

Ordered by how much visible difference the work makes, highest first.

| # | Asset | Count | Current state | Format wanted |
|---|-------|-------|---------------|---------------|
| 1 | Shop icons — buildings + upgrades | **47** | system emoji | SVG, ~54px tile |
| 2 | Hex the cat — animation rig | 1 (10 named parts) | inline SVG, hand-built | SVG with exact ids |
| 3 | The mouse — one silhouette, 3 renderers | 1 + 5 colorways | inline SVG paths | SVG in a 54×28 box |
| 4 | The golden mouse | 1 | same mouse + a gradient | SVG, 62px |
| 5 | Night-wall scene shapes | 4 elements | code-authored curves | single-stroke paths |
| 6 | The single-stroke alphabet | 6 glyphs + space | code-authored | single-stroke paths |
| 7 | Environment — day + night backdrops | ~5 layers | CSS gradients | see §6 |
| 8 | UI chrome — coin, badges, tray, gate | ~8 | CSS + emoji | SVG |
| 9 | Favicon / app icon | 1 | 🐱 emoji in a data URI | SVG + PNGs |

Roughly: **47 icons is the bulk of the work**, the Hex rig is the highest-skill
piece, and items 5–6 are optional collaboration rather than a hand-off.

---

## 1. How art gets into this game

Read this before drawing anything — it rules out several normal deliverables.

**Vector, not raster.** Art is scaled at runtime by viewport-relative math, and
some of it is drawn twice at wildly different sizes (Hex renders at ~300px by day
and at a **quarter** of that at night; the mouse renders at 36px as a tap
particle and at ~7px on the night wall). Nothing may be delivered as a fixed-size
bitmap except the app icon.

**Art is animated per-part by JavaScript, by `id`.** Hex's ears, eyelids, pupils,
jaw and whiskers are each grabbed by element id and given transforms every frame
(`src/cat.js`). A flattened export — outlines merged, ids stripped, groups
renamed by the exporter — silently kills roughly a dozen animations. The id
contract is in §3 and it is not negotiable.

**Some art is not a file at all.** The night wall is *drawn by mice walking along
paths*. The wall's shapes exist as `moveTo`/`bezierCurveTo` calls executed
through a tracer that converts them to walkable point tours (`src/wall.js`). Art
for that system is a **path**, not a picture — see §5.

**Two themes, one asset.** The game hard-flips from a bright Cookie-Clicker day
skin to a near-black dream at night (`body.night`). Any asset that survives the
flip has to be legible on `#2e6699` striped blue **and** on `#06070c`. Practically
that means: keyline-first art with a light stroke, no white-on-white, no
dark-on-transparent.

**Mobile portrait, at arm's length.** The target device is a phone at 390×844.
Icons are read at ~28px, the wall mice at ~7px. Detail below that threshold is
wasted, and the existing art has already lost fights at these sizes (see the note
in `src/art.js:52-57` about why the currency coin is cropped to the mouse's head).

---

## 2. Tier 1 — the shop icon set (47 icons)

**The single biggest visual win available.** Every building and upgrade row in
the shop currently renders a system emoji, which means the game's whole
storefront is drawn in Apple's or Google's art style, at their color temperature,
in a style that matches nothing else on screen. Nine of the 47 are also duplicated
or approximate because emoji ran out (three rows share 🪟, two share 🌳, two share
💨, two share 🧵, two share 🚚).

- **Where:** `packages/shared/src/hex/data.ts`, the `icon:` field on every
  `BUILDINGS` and `UPGRADES` entry. Rendered by `src/shop.js:248` and `:405`.
- **Tile:** 54px wide × full row height (~61px), centered, on a tinted column —
  `rgba(0,0,0,.26)` by day, `#171a21` at night. Glyph reads at ~27px.
- **Deliver:** one SVG each, square viewBox, art centered with a little padding,
  legible at 28px. Named by the row's stable key (`shopper`, `farm`,
  `cardboardbox`, …), which is the first column below.

### Buildings (7)

| key | name | now |
|---|---|---|
| `shopper` | Mouse Subscription | 🚚 |
| `farm` | Mouse Farm | 🌾 |
| `factory` | Mouse Factory | 🏭 |
| `lab` | Schrödinger's Lab | 🔬 |
| `portal` | Hole in the Wall *(night)* | 🕳️ |
| `spindle` | Ball of String Theory *(night)* | 🧵 |
| `delta` | Dream Within a Dream *(night)* | 🌀 |

### Upgrades (40)

Day economy — `shopper1` 2-Day Shipping 🚚 · `shopper2` Subscribe & Save 🔁 ·
`shopper3` Wholesale Liquidation Pallets 🏷️ · `shopper4` Import Direct from
Manufacturer 🚢 · `farmplow` Sisal Scratching Plows 🧶 · `farmfeliway` Feliway
Sprinklers 💨 · `farmlaser` Laser-Guided Planters 🎯 · `farmchuru` Churu
Hydroponics 🍦 · `farmdrone` Autonomous Bug-Batting Drones 🚁 · `factory1` Sisal
Conveyor Tracks 🧵 · `factory3` LED Weaving Looms 💡 · `factory4` Pneumatic
Crinkle Packagers 🎁 · `farm2` Mice from Theory 🧬 · `labparcels` 2 Second
Shipping 🚀 · `factoryfactory` Factory Factory 🪆

Petting / click power — `whiskers` Cat Tree 🌳 · `scratchpost` Scratching Post 🪵 ·
`clawsharp` Cat Brush 🪮 · `cardboardbox` Cardboard Box 📦 · `scratchpost2`
Reinforced Scratching Post 🪢 · `pounce` Pounce Reflex 🐾 · `milk` Window Perch 🪟 ·
`cattree` Window Perch, Second Window 🪟 · `cardboardcastle` Cardboard Castle 🏰 ·
`chinscritch` Chin Scritch 😌 · `windowperch` Third Window Perch, Second Window 🪟 ·
`dryfood` Dry Food, Same As Yesterday 🥣 · `ovenmitts` Bite-Proof Oven Mitts 🧤 ·
`jailgoomba` Lock Goomba in Cardboard Castle 🚔 · `cattreetable` Cat Tree, On the
Table 🌳 · `freshair` A Breath of Fresh Air 💨

The twist + the night — `catnap` **Catnap Hypnalysis** 💤 *(the story beat: this is
the button that ends the day — it deserves the best icon in the set)* · `lantern`
Paper Lantern 🏮 · `paperlantern` Lucid Dreaming I 🛌 · `luciddreaming` Lucid
Dreaming II 🌀 · `countingmice` Counting Mice 💭 · `deepsleep` Lucid Dreaming III 😴 ·
`lucky6` Lucky Number 6 🎲 · `remsleep` Lucid Dreaming IV 👀 · `hypnagogia` Scent
Trail 👣

**Notes for the set:**
- The three-row "Window Perch" and two-row "Cat Tree" jokes are *deliberate*
  escalating gags in the copy. The icons should escalate with them rather than
  repeat — one window, two windows, three windows.
- Night rows (the last block) are seen only against `#171a21` with gold accents.
  They can lean darker and more luminous than the day set.
- A locked building row shows `?` instead of the icon (`src/shop.js:248`,
  `.icLocked`) — that stays as type, no art needed.

---

## 3. Tier 2 — Hex

Hex is the thing you tap. She is one inline SVG in
`apps/hex-clicker/index.html:1117-1142`, with `prototypes/hex-cat.svg` as the
Figma source of truth (that file's header comment documents the round-trip).

**Current design:** a head-only "faithful sticker" — solid black fill `#111114`,
8px white keyline `#F4F4F2`, green almond eyes `#65C256` with black pupils,
2.4px mouth, 2.2px whiskers. viewBox `0 0 200 210`.

### The id contract

Every one of these is grabbed by `src/dom.js` and transformed by `src/cat.js`.
Rename or merge any of them and that animation silently dies:

| id | what it is | what the code does to it |
|---|---|---|
| `catFace` | group wrapping the whole head | head tilt, ±7°, pivot at 50%/96% |
| `headFill` | the black silhouette, **no stroke** | static |
| `headOutline` | white keyline of the *lower* head only | recolored gold during Zoomies (`.catLine`) |
| `earLeft` | group: black fill + white V outline | independent flick ±11°, pivot 52%/90% |
| `earRight` | same | independent flick, pivot 48%/82°, swivels toward the golden mouse |
| `eyeLeft` / `eyeRight` | the green iris shapes | `scaleY` for blink (.14), slow blink, yawn; recolored `#ffe98a` during Zoomies |
| `irisLeft` / `irisRight` | the black **pupils** (name is historical) | translate to look around; `scaleX` 0.22 (slit) ↔ 1 (dilated) |
| `mouth` | the lip line | `scale` up to 2.2× Y / 1.5× X for the yawn; ~11Hz chatter. Pivot is *top center* |
| `whiskers` | all six whiskers as **one path** | fanned forward `scale(1.07,1.12)` at prey; rotate ±1.6° for dream twitches |

**Structural requirements a redesign must satisfy:**

1. **The head is split into four pieces that recompose exactly at rest** —
   a stroke-less black fill, a white outline of *just* the lower head and the
   valley between the ears, and each ear as its own fill+outline group. This
   split is what lets an ear tilt and reveal only black behind it. See the
   comment at `index.html:1118-1124`.
2. **The eye is two shapes, not one.** A socket/iris shape that squashes for
   blinks, and a separate pupil that scales independently on X (slit ↔ round).
   The pre-SVG version drew one ellipse per eye and blinking squashed the pupil
   with it.
3. **Whiskers are one path.** Six strokes, one element — the code notes this
   rules out per-whisker animation, and that's accepted.
4. **The mouth must have ~35 units of clearance below it** inside the
   silhouette. The yawn scales the lip line to 2.2× from its top edge; the
   current ceiling was measured (`mouth.getBBox()` vs `head.getBBox()`) and is
   documented at `src/cat.js:189-194`. **If the face moves, that number must be
   re-measured.**
5. **Hit-testing is per-shape.** A tap in the gap between her ears must not
   count as a pet, which works because the root `<svg>` is
   `pointer-events: none` and children re-enable it. Don't add a full-bleed
   background rect.

**She renders at two sizes:** `min(55%, 300px)` of the viewport by day, and
**a quarter of that** at night, parked in the middle of the wall's orbit. Detail
that dies at ~75px wide is detail that vanishes for the entire second half of
the game.

**Scope note:** she is a *head*. Body, paws and tail have never existed. Adding
them is a design decision, not an art decision — the night pose, the orbit
clearance (§5) and the tap target are all calibrated to a head, and several
jokes in `src/cat.js` depend on it ("a golden mouse drifting past a cat who is a
head and can do nothing about it").

---

## 4. Tier 3 — the mouse

One silhouette, drawn by **three** renderers, defined once in `src/art.js`.

- **Box:** 54×28, facing right. Tail `M12 17 C4 21 2 10 8 7` (2.6px stroke),
  teardrop body, one ear circle (r 4.6 at 33,7), one eye dot (r 1.8 at 42,12).
- **Keyline:** `#f4f4f2`, 2px — same sticker family as Hex.
- **Colorways (5):** yellow `#ffd44d`, blue `#5fb0ff`, pink `#ff6fa5`,
  green `#5fe0a0`, purple `#b48cff`. These are not decorative: on the night wall,
  **yellow always spells the code word** and each scenery element owns one of the
  other four. In multiplayer they also identify which teammate tapped.

**The three renderers, and what each demands:**

| renderer | where | size on screen | needs |
|---|---|---|---|
| tap particle | `src/fx.js` | 36px, arcs + spins + fades in 0.9s | reads while rotating |
| golden mouse | `src/golden.js` | 62px, pulses and drifts | see §4b |
| wall mouse | `src/wall.js:937` | **~7px**, canvas | must survive being redrawn as ~6 canvas primitives |

That last one is the hard constraint: the wall mouse is not the SVG — it is the
same numbers re-expressed as `arc`/`fill` calls on a canvas, ~90 of them on
screen at once at 60fps. **A silhouette that can't be rebuilt from a handful of
filled primitives cannot go on the wall.** If the mouse is redesigned, the canvas
version has to be redrawn to match, by us, and complexity there costs frames.

### 4b. The golden mouse

The same silhouette in gold — a 3-stop vertical gradient (`#fff6c4` →
`#ffd44d` → `#c98a12`) plus one white specular highlight stroke
(`src/golden.js:23-32`). It's the game's one "excitement" object: it drifts
around the stage, pulses `scale(1)→1.14` with a ±6° rock, and carries a strong
gold drop-shadow. Deliberately a *material* difference from the yellow mouse, not
a hue difference. If the mouse is redrawn, this needs its gilded variant.

---

## 5. Tier 4 — the night wall (collaboration, not hand-off)

This is the game's finale and the strangest thing to make art for. Once Hex falls
asleep, ~33 mice patrol a hidden drawing, leaving glowing trails; as the trails
lengthen, the drawing inks in and the words **TO THE MOON** become readable. The
mice *are* the pen.

**Consequence:** wall art must be authored as **single continuous strokes**, in
scene coordinates, in a 390×620 reference box. Not shapes with fills. A closed
loop makes its mouse circle forever; an open stroke makes it ping-pong.

**Current scene** (`src/wall.js:520-564`), four elements plus the word:

| crew | element | mice | notes |
|---|---|---|---|
| yellow | the word `TO THE` / `MOON` | 9 | one mouse per letter |
| pink | a comet — nucleus + 4 bowed tail strands | 10 | the longest tour on the wall |
| blue | an elliptical orbit | 4 | Hex sleeps at its center |
| green | a ringed planet — disc + ring | 4 | stands on the orbit |
| purple | the Big Dipper as one Euler path | 6 | all 7 stars drawn inline as spokes |

**Hard rules any new wall art must obey** — all of these were paid for and are
documented in-file:

1. **Everything lives in the top half** (scene y < 320 of 620). Below that is
   behind the shop tray all night. The empty bottom band is not slack; it is what
   lifts the art clear of the dock.
2. **Long structure, compact payload.** A shape that a mouse can lap quickly
   gives the puzzle away immediately. Orbits, tails and constellation figures
   work because they genuinely cross the frame.
3. **One continuous stroke wherever possible.** The Big Dipper is drawn as an
   Euler path with the stars as inline detours specifically because the naive
   version (figure + 7 separate stars) made the tour 11× longer, 91% of it
   backtracking.
4. **Nothing may crowd Hex.** She sits at the orbit's center with ~20 scene units
   of clear sky above and below, and the ringed planet is deliberately sized and
   positioned to stop 21 units short of her silhouette.
5. **The word's size is frozen.** `TO THE` at 34, `MOON` at 78. Those two numbers
   set the total ink that the whole reveal's pacing and legibility math divides
   by. Scenery can be recomposed freely; the word cannot.

**The alphabet** (`src/wall.js:303-314`) is a 6-glyph single-stroke
("engraver's") face — `T O H E M N` plus space, each one pen path in a 100-tall
box, deliberately cut wide. A type-minded artist could redraw it, subject to: one
continuous stroke per letter, retracing allowed (T doubles back along its bar),
`O` must be authored closed, and every letter of the code word must exist or the
game throws at boot.

---

## 6. Tier 5 — environment

All CSS today. Replacing these is optional but it's where the "cheap web page"
feel comes from.

| layer | now | where |
|---|---|---|
| Day wallpaper | 26px repeating blue stripes `#2e6699`/`#295c8b` + a radial light bloom | `--page-bg`, `index.html:106` |
| Day sunburst | a rotating conic gradient, 5°-on/6°-off spokes, 90s/rev, masked to a soft disc | `#rays`, `index.html:236` |
| Wood framing | 3-stop brown gradient on the shop tray | `--wood`, `index.html:110` |
| Night sky | flat `#06070c` + a faint violet radial | `#nightSky`, `index.html:182` |
| Starfield | 54 seeded CSS dots, `#dfe9ff`, staggered twinkle | `src/phase.js:36` |
| Sleeping `z`s | three type characters drifting up | `#sleepZ`, `index.html:476` |

The day skin is an intentional Cookie Clicker pastiche — that's the setup for the
twist, where it's all stripped away. Any redesign should keep the day *cozy and
familiar* and the night *bare*; the contrast is the whole story beat.

---

## 7. Tier 6 — UI chrome and one-offs

| asset | now | notes |
|---|---|---|
| **Currency coin** | the mouse's head, cropped, in `--neon` `#57e6c9` | Appears beside every price and in the HUD. Cropped to the head because the full silhouette read as a flat pill at 15px. One constant color — it must never look like an afford/can't-afford cue |
| **"new" badge** | a red `#e5484d` pill with a count | `index.html:858` |
| **Buff pill** | gold-on-brown "⚡ ×N" capsule under the HUD | `#buff` |
| **Shop caret** | a rotated CSS border corner | deliberately not a glyph, so it scales |
| **Float "+N"** | type only, white by day / gold at night | probably stays type |
| **Rotate-to-portrait screen** | a rotating emoji glyph | `index.html:1073` |
| **Join gate** | `🐱 Hex Clicker` heading, name field | the first screen a player ever sees — currently unstyled |
| **Favicon / app icon** | 🐱 emoji in an inline data URI | wants a real mark: SVG + 180/192/512 PNGs |
| **Team strip** | text only, per-slot | teammates are already color-coded by the 5 mouse colors |

---

## 8. Palette and type

The game has exactly one color table and it is small. New art should live inside
it rather than extend it.

```
--gold  #ffd44d   night accent, the golden mouse, night prices
--neon  #57e6c9   the currency coin, UI teal
keyline #f4f4f2   every sticker outline (Hex, all mice)
ink     #111114   Hex's fill
eyes    #65c256   Hex's irises  /  #ffe98a when Zoomies fires

mice    yellow #ffd44d · blue #5fb0ff · pink #ff6fa5 · green #5fe0a0 · purple #b48cff

day     bg #2e6699/#295c8b · wood #b07c45→#5e3a1a · ink #f6f1e6
        cost ok #7fe37f · cost no #e2645e
night   bg #06070c · panel rgba(9,11,18,.93) · ink #b9c2d4 · icon tile #171a21
```

**Type:** Baloo 2, embedded as a base64 woff2 subset in `index.html:57`. If new
copy introduces characters outside the current subset they will fall back to
system UI — flag any glyph additions.

---

## 9. Delivery

- **SVG, optimized but not flattened.** Keep ids on anything §3 lists. Do not let
  the exporter merge shapes, convert strokes to outlines on Hex, or rename groups.
- **No embedded rasters inside SVG.**
- **One file per asset**, named by its key (`shopper.svg`, `catnap.svg`,
  `hex.svg`, `mouse.svg`, …). We inline them at build time; the artist does not
  need to touch the build.
- **Check every asset at its real size** before delivering: icons at 28px, the
  wall mouse at 7px, Hex at 75px.
- **Check every asset on both backgrounds** — `#2e6699` and `#06070c`.
- Hex specifically: deliver as a Figma file *and* an SVG export, since
  `prototypes/hex-cat.svg` is a documented round-trip and the id contract has to
  survive re-export.

## 10. Explicitly not assets

So nobody draws these by mistake — they are generated and would be thrown away:

- Mouse **positions** on the night wall (a pure function of room seed, mouse
  index and the shared clock, identical on all four phones).
- The **starfield** layout (seeded).
- **Trails and ink** (accumulated on an offscreen canvas as the mice walk).
- Every **transition and easing** — the yawn, the camera pull-back, the day→night
  dissolve, the shop slide.

## 11. Open questions to settle before the work starts

1. **Does Hex stay a head?** Everything downstream is calibrated to it (§3).
2. **How far does the icon set go stylistically** — flat neon line art matching
   the sticker keyline, or something with more material?
3. **Is the day skin's Cookie Clicker pastiche kept as a joke, or replaced?** It
   is deliberate, and the twist's impact depends on it.
4. **Does the wall scene stay `TO THE MOON`?** The word is a shared constant
   (`packages/shared/src/hex/data.ts`) and the wall art is hand-placed for that
   exact string — they change together or not at all.
5. **Do we want the sibling apps** (lobby, chat, proctor) **in the same pass?**
   This brief covers Hex Clicker only.
