# Scent Tracker — Feasibility + POC Spec

A phone as a lens: hold it up and a glowing/dusty trail lies on the floor of
your home, drifting toward a hidden place. Follow it to the end. (The
reference is the Silksong trail-following side quest.)

This document answers three things: **is it feasible**, **does the floor plan
save us**, and **what exactly to build first**. Written as a spec, not a
prototype — no `scent-tracker.html` exists yet.

_Last updated: 2026-08-04._

---

## Verdict

**Yes, this is AR, and yes it's buildable — but not as one thing.** It's three
separate problems with very different difficulty:

| Problem | Difficulty | Notes |
| --- | --- | --- |
| Render a trail that convincingly lies on your floor | **Easy** | Solved by any 6DoF AR runtime + a hit test. A day's work. |
| Keep it glued there while you walk one room to another | **Medium** | This is the drift question. Manageable at apartment scale. |
| Have it mean the same thing across sessions/devices/homes | **Hard** | This is *indoor relocalization*, and it's the real project. |

The good news for your stated goal — *"I want to try it in my own apartment
first"* — is that you only need the first two. **Skip the floor plan entirely
for the POC.** More on why below.

The bad news is a platform constraint that dominates every technical choice,
so it goes first.

---

## The constraint that decides everything: iOS

**Safari on iOS/iPadOS does not implement WebXR.** Not behind a flag, not
partially — Apple has never shipped it and has not announced plans to. Safari
on visionOS supports `immersive-vr`, but the AR module isn't enabled even
there, and that's a headset, not your phone. This has been true for years and
is still true in 2026.

So "visit a mobile web page" resolves differently per platform:

| Platform | Plain WebXR (`immersive-ar`) | Verdict |
| --- | --- | --- |
| Android Chrome | Yes, via ARCore | **Works today, zero SDK** |
| iOS Safari | No | Needs a different runtime |
| Desktop | N/A | Not the target |

A PWA does not help. A PWA is a web page with a manifest; it gets exactly
Safari's engine and exactly Safari's API surface. **On iOS, "make it a PWA"
buys you nothing for AR.** Only a native app (ARKit) or a WebAR SDK that ships
its own tracker changes the answer.

### The iOS escape hatch, and it just got much better

**8th Wall went open source in February 2026.** Niantic wound down the hosted
platform (cloud editor, logins, XR Studio all shut down on 28 Feb 2026) and
released the framework, modules, Image Targets, and tooling under MIT. The
**engine binary — including its own SLAM/world tracking — is distributed free,
with no login and no API key**, straight off a CDN:

```html
<script src="https://cdn.jsdelivr.net/npm/@8thwall/engine-binary@1/dist/xr.js"
        async crossorigin="anonymous" data-preload-chunks="slam"></script>
```

This matters enormously here. 8th Wall runs its own visual-inertial tracker in
WASM against `getUserMedia`, so it **works in iOS Safari** — that's the entire
reason it existed as a $700–3,000/project/month product until this year. It
also ships **Image Targets** in the free binary, which is the marker capability
WebXR still lacks (see below).

Two caveats, stated honestly:

- The SLAM component is **binary-only under a "limited-use license"**, not MIT
  like the rest. Read `LICENSE` in `8thwall/engine` before shipping anything
  beyond a personal experiment. For "try it in my apartment," you're fine.
- The cloud is gone. You host it yourself. Given `prototypes/` already deploys
  static to Vercel, that's not a real cost for you.

### Recommendation

**Build the POC on WebXR if you have an Android phone in the house; otherwise
go straight to the 8th Wall binary.** Design the code so this is one swappable
file either way — see the [backend seam](#the-backend-seam) below. Don't build
native. ARKit/ARCore would give you the best tracking available, but you'd be
spending your first week on Xcode and provisioning profiles rather than on
whether a glowing trail is fun to follow, and the answer to *that* is what you
actually need.

---

## Does AR lose its position without markers? Yes. Here's the real shape of it.

You heard right, but the common phrasing ("AR needs markers") is misleading.
Modern phone AR is **markerless by default** — ARCore and ARKit both run
visual-inertial odometry (VIO): track visual features frame to frame, fuse with
the IMU, integrate into a pose. No markers required to start. The problem isn't
that it can't work without markers; it's *how it degrades*.

There are two failure modes, and they are not equally important:

**1. Slow drift.** Error accumulates as you move — very roughly on the order of
~1% of distance travelled under good conditions. Across a one-bedroom apartment
(call it 15–25 m of walking), that's **tens of centimeters**. This sounds bad
and is almost entirely a non-problem for you. A scent trail is not a surgical
overlay; being 20 cm off is invisible when the thing you're drawing is a
half-meter-wide band of drifting motes.

**2. Tracking loss and bad relocalization.** This is the one that will actually
hurt. It happens when the camera stops seeing usable features:

- you lower the phone to your side while walking to the next room
- you point it at a blank white wall or a dark hallway
- you turn fast, or the room is dimly lit
- someone walks through frame filling it with motion

Recovery is a jump, not a slide — the world can shift a meter or rotate, or the
session can reset outright. **One bad relocalization ruins the illusion in a way
that ten meters of gradual drift never does.** Design for this specifically
(there's a section on it below); it's more important than any accuracy work.

Featureless modern interiors are the adversarial case — a white-walled hallway
is genuinely hostile to VIO. A cluttered apartment with books, rugs, furniture,
and posters is a *good* environment. Yours is probably fine.

---

## Does having the floor plan save you?

**Not on its own, and not in the way it feels like it should.** This is the most
important correction in this document, so it's worth being precise about why.

A floor plan is a **map**, not a **sensor**. AR gives you a pose in the
session's own arbitrary coordinate frame, whose origin is wherever you happened
to be standing when the session started, with an arbitrary heading. The floor
plan is in its own frame, in meters. To use one with the other you need two
things, and the floor plan only helps with the second:

1. **Registration** — a one-time transform (rotation + translation) that lines
   plan space up with AR space. The plan cannot supply this. Something has to
   tell the app *where in the plan you are right now*. That's a marker, a
   manual calibration, or a relocalization system.

2. **Drift correction** — repeatedly re-aligning as you walk. Here the plan
   *can* genuinely help, because it's a prior you can match live sensor data
   against. ARCore/ARKit detect vertical planes; project them to the floor, and
   you get 2D line segments that you can fit to the plan's wall segments (ICP or
   a similar point-set registration). Every good fit is a drift reset. This is
   roughly how real indoor AR navigation works, and it is **the one thing on
   this page that is legitimately hard** — plane detection is noisy, furniture
   isn't in the plan, and a wrong match snaps you into the wrong room, which is
   worse than drifting.

The plan's *other* value is real but unglamorous: it lets you **author routes
without being in the building**, and it gives you named semantic places ("under
the bed") to hide things at.

**For your apartment POC, skip the floor plan.** Don't measure anything, don't
import anything. Author the route by **walking it and tapping**, which produces
a path already in AR coordinates — registration problem deleted, not solved.
The plan becomes worth building the moment you want the game to work in *someone
else's* home, and that's a much later problem.

---

## Do you need to print markers? No — and existing objects work.

Direct answers to the two questions you asked:

**Do you need to print anything for the POC?** No. Use **two-point
calibration** instead (spec'd below): put two bits of masking tape on the
floor, aim a crosshair at each and tap. Two points give you translation and
heading; gravity gives you the rest for free because AR runtimes are already
gravity-aligned. Ten seconds, no printer, no SDK, no Chrome flags. This is the
right answer for a POC and possibly for the shipped game too.

**Can you use an object you already own as a marker?** **Yes** — this is a
standard capability called an *image target*, and any flat, textured thing
qualifies. You photograph it once, the tracker extracts features, and
thereafter seeing it gives you a full 6DoF pose accurate to a couple of
centimeters. Re-seeing one **completely erases accumulated drift**, which makes
image targets the cheapest good answer to the drift problem.

What makes a good image target:

| Works well | Fails |
| --- | --- |
| Board game box, book/vinyl cover, cereal box | Blank or solid-colored surfaces |
| Framed poster or art print (matte) | Glossy, reflective, or backlit things (screens!) |
| A busy patterned rug or throw | Repeating/tiled patterns (can't disambiguate) |
| A cluttered bookshelf face | Symmetric designs (ambiguous rotation) |
| Router/appliance with a detailed label | Anything that moves — a cushion, a chair |

Requirements: **flat, matte, visually busy, non-repeating, asymmetric, at least
~20 cm across, and permanently in place.**

The catch: **WebXR's image tracking is not shipping.** The Image Tracking API
has sat behind Chromium's `#webxr-incubations` flag for years with little
movement. So on the plain-WebXR path your options are (a) enable the flag on
your own phone — fine for a personal POC, unusable for anything you'd share, or
(b) use the 8th Wall binary, which ships Image Targets and works cross-platform,
or (c) don't use markers at all and lean on two-point calibration.

A printed ArUco/AprilTag would be more robust than any household object and
costs one sheet of paper — but for the shipped game, real objects are strictly
better for the *fiction*, and the fiction is the product. If you ever do need
printed markers in the real game, disguise them as props: a cat poster you're
told to tape up as part of the setup.

---

## What to build

### Milestone 0 — the drift rig (do this first, it's half a day)

**Do not build the game first.** Build the instrument that tells you whether
the game is possible in *your* apartment, because the honest answer to "how bad
is drift for you" is unknowable from a document.

- Enter AR, hit-test the floor, drop a marker cube on a piece of tape.
- Walk your intended route — bedroom, hall, kitchen, back. Hold the phone the
  way a player actually would, i.e. badly: lower it, pocket it, walk fast.
- Return to the tape. **Measure how far the virtual cube now sits from it.**
- Do it five times. Log the numbers and the qualitative failures.

If the median return error is under ~30 cm, everything below works. If it's
metres, or the session resets on the hallway, you've learned that this
apartment needs image-target checkpoints before you write any game code. Either
way you spent half a day instead of two weeks.

### Milestone 1 — walk-to-author + trail (the fun test)

Single session, no persistence, no plan, no markers. This is the one that
answers "is this fun."

- **Author mode:** walk the route, tap to drop breadcrumbs at each point.
- **Play mode:** the trail renders through those points; walk it.
- **End:** reach the last point, get a reveal.

If following a trail through your own hallway doesn't feel good here, no amount
of localization work will save it. This is the milestone that matters.

### Milestone 2 — persistence across sessions

Save the route; make it replay tomorrow. Registration via **two-point
calibration** (tape on floor), or an image target if you're on the 8th Wall
backend. Route persists in `localStorage` keyed by a space id.

### Milestone 3 — drift correction en route

Only if M0 says you need it. In preference order:

1. **Image-target checkpoints** — 2–3 household objects along the route. Every
   sighting is a hard reset to truth. Simple, robust, effective.
2. **Periodic manual re-anchor** — a diegetic "sniff here" beat at a doorway
   that quietly re-registers. Cheap, and the player thinks it's gameplay.
3. **Plane-to-wall ICP against the floor plan** — the real solution, the big
   project, and the only one that needs the plan. Don't start here.

---

## Spec

### Stack

Three.js from a CDN ESM import, plus WebXR. **This deliberately breaks the
`prototypes/` zero-dependency rule** — flagging it rather than sneaking it in.
The rule exists so prototypes stay a single file with no build step, and that
still holds (import map, no bundler), but AR plumbing plus a particle system in
raw WebGL2 is a few hundred lines of ceremony that has nothing to do with
finding the fun. Three's `renderer.xr` and hit-test helpers pay for themselves
in a day.

WebXR requires a secure context. `prototypes/` already deploys to Vercel over
HTTPS, so that's solved; for local iteration use `adb reverse tcp:8080
tcp:8080` and hit `localhost` on the phone, which counts as secure.

### Coordinate spaces

- **World space** — the AR session's frame. Request `local-floor` so **y = 0 is
  the floor for free**. Refine with a hit test if the estimate looks off.
- **Plan space** — 2D metres `(x, z)`, y implied 0. Where routes are authored
  and stored.
- **Registration** — a yaw θ and a translation `(tx, tz)`. Scale is 1 by
  construction (both metric); *compute* it anyway as a diagnostic — if measured
  scale deviates more than ~5% from 1.0, your calibration taps or your tracking
  are bad, and you should say so in the UI rather than render a broken trail.

### Data format

```jsonc
{
  "spaceId": "home-floor-1",
  "createdAt": "2026-08-04T00:00:00Z",
  "calibration": {                       // omitted in M1 (session-local)
    "kind": "two-point",
    "a": [0.0, 0.0],                     // plan-space, metres
    "b": [3.0, 0.0]
  },
  "route": [                             // plan-space polyline, floor level
    [0.6, 0.5], [2.0, 1.2], [3.4, 3.0], [5.0, 5.4]
  ],
  "goal": { "p": [5.2, 6.1], "radius": 0.75, "label": "under the bed" }
}
```

Note `goal.radius`. **The goal is a place, not a point** — never require pose
accuracy you can't deliver.

### Modules

```
arBackend.js    the seam (see below)
calibrate.js    two-point registration → { theta, tx, tz, scaleError }
route.js        author/persist/resample the polyline
trail.js        particle system: sample route → motes → render
game.js         state machine, proximity, reveal, tracking-loss UX
```

Core signatures:

```js
// calibrate.js
solveTwoPoint(planA, planB, worldA, worldB) -> { theta, tx, tz, scaleError }
planToWorld(reg, [px, pz])                  -> THREE.Vector3   // y = floorY
worldToPlan(reg, vec3)                      -> [px, pz]

// route.js
resample(points, spacingM = 0.15)           -> points[]        // Catmull-Rom
distanceAlong(route, planPos)               -> { s, lateral }  // arc-len + offset

// trail.js
update(dt, playerPlanPos, route)                                // reveal window
// -> motes within [s_player - 1m, s_player + REVEAL_AHEAD]

// arBackend.js
{ start(), pose(), hitTestFloor(x, y), imageTargets(), stop() }
```

### The trail

- Resample the polyline to ~15 cm spacing, Catmull-Rom for smoothness.
- Emit **discrete motes, not a continuous ribbon.** A hard-edged ribbon makes
  every centimeter of misalignment legible; a scatter of drifting particles
  hides it completely. This is a rendering choice doing localization work.
- Per-mote: seeded phase offset, slow upward drift + sine sway, respawn at the
  floor. Additive blending, billboarded quads, soft radial alpha.
- Band width ~40–50 cm, jittered — wide enough to absorb lateral error.
- Depth-test against detected planes if the backend gives you depth; if not,
  don't bother for the POC.
- **Reveal window:** only render motes from ~1 m behind the player to
  `REVEAL_AHEAD` (start at 3 m) in front. Everything else fades to nothing.
  This is the single highest-value trick in the spec — **you cannot see global
  drift if you can never see the global path.** It also happens to be exactly
  the mechanic you want ("the scent is strongest nearby"), so the constraint
  and the fantasy point the same direction.
- Intensity, mote density, and `navigator.vibrate()` all scale with proximity
  to the goal. Note vibration is unavailable in iOS Safari — don't make it
  load-bearing.

### Handling tracking loss

Non-optional, and it's a design problem more than an engineering one. Detect
it: WebXR gives you `XRFrame.getViewerPose()` returning null, plus
`visibilitychange` and ARCore's tracking-state reasons.

**When tracking degrades, do not keep drawing the trail as if nothing is
wrong.** Fade it out and switch to a diegetic prompt — *"the scent is faint —
look around slowly"* — until tracking recovers. This converts your ugliest
technical failure into an atmospheric beat, and players will read it as
intended behavior rather than a bug. It's the highest-leverage fifteen lines in
the project.

Corollary: never render a hard-edged world-locked object (an arrow, a door
outline) that the player can compare against reality. Everything is soft,
drifting, and deniable.

### The backend seam

Keep every AR call behind `arBackend.js` exposing exactly:

```js
start() -> Promise<void>      // session + reference space
pose()  -> { position, quaternion, tracked: bool, reason?: string }
hitTestFloor(screenX, screenY) -> { point: Vec3 } | null
imageTargets() -> [{ id, position, quaternion, visible }]   // [] if unsupported
stop()
```

Two implementations, `webxr.js` and `eightwall.js`. Everything above the seam
is renderer and game logic and never learns which is running. This is what lets
you start on Android in a day without foreclosing iPhone.

---

## Effort

| Milestone | Estimate |
| --- | --- |
| M0 drift rig | half a day |
| M1 walk-to-author + trail | 1–2 days |
| M2 persistence + two-point calibration | 1–2 days |
| M3 image-target checkpoints | 2–3 days |
| M3′ floor-plan ICP drift correction | weeks — a real project |

M0 + M1 is a weekend and tells you almost everything.

---

## Open questions

- **Which phone are you testing on?** Decides WebXR vs 8th Wall on day one.
- Is the destination fixed per home, or does the game hide it somewhere new
  each play? The latter needs traversable-space knowledge — i.e. the floor plan
  becomes load-bearing rather than optional.
- Single-player, or does this join the Escape Cats coop architecture? Four
  phones tracking one trail through one apartment is a different (and much
  harder) problem: they'd each have their own drifting frame and would need to
  share a registration.
- How does the trail read in daylight vs a dark room? Additive glow on a
  bright camera feed can wash out completely. Worth checking in M1.

---

## Sources

- [The state of WebXR on iOS, and beyond — Variant Launch](https://launch.variant3d.com/blog/23-06-state-webxr-on-ios-beyond)
- [WebXR on iOS — What Works in Safari in 2026 · XRDoctors](http://xrdoctors.pro/blog/webxr-on-ios-what-actually-works)
- [WebXR Browser Support in 2026: What Works, What Breaks](https://www.testmuai.com/learning-hub/webxr-compatible-browsers/)
- [Niantic's WebAR Platform 8th Wall Goes Open Source — Road to VR](https://roadtovr.com/niantic-webar-platform-8th-wall-open-source/)
- [8thwall/engine — the distributed engine binary](https://github.com/8thwall/engine)
- [8thwall/8thwall — framework and modules (MIT)](https://github.com/8thwall/8thwall)
- [WebXR Image Tracking API — explainer draft](https://github.com/immersive-web/marker-tracking/blob/main/explainer.md)
