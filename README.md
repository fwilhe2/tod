# TYPE OR DIE

A keyboard horror rail-shooter for the browser — an original, legally-distinct
homage to the classic "type words to shoot zombies" arcade genre. Built with
Three.js (WebGL) and Vite. No art or audio assets: every zombie, building, and
sound effect is generated procedurally at runtime.

![Screenshot of Gameplay](./gameplay.png)

## Story

The canal city of **Porto Morto** has gone quiet. You are Agent **Verdana** of
the Bureau of Ergonomic Defense, armed with a field keyboard wired to a car
battery on your back. Fight through five canal districts, then face
**Aurelius Vane, "The Chancellor"** — a banking tycoon with strong opinions
about compound interest and the apocalypse.

## How to play

- **Type the word** floating above a ghoul to open fire — every correct letter
  is a shot, finishing the word drops it.
- The first letter you type **locks on** to the nearest matching ghoul; typos
  break your combo (and your accuracy grade).
- Don't let them reach you — you have 5 hearts. A ghoul that lands a hit is
  knocked back and gets a fresh start on its word.
- Every letter you land shoots a piece off — hands, arms, jaw — and the
  final letter takes the head. Watch the canal: some of them wade out of it.
- A rare **barista ghoul** (amber eyes, still carrying the cup) refunds one
  heart when dropped.
- Each district has its own weather — mist, blackout, blood moon, storm —
  and the synth score gets busier the closer the horde shambles.
- Idle on the title screen for a while and the game will play itself
  (arcade attract mode — any key takes back the controls).
- **Boss fight:** type his full doom-laden sentences before the amber timer
  runs out, or take a hit.
- **Three endings**, decided by how you answer his final question — truthfully,
  greedily, or strangely.
- `Esc` pauses. `Enter` confirms / continues (continues cost coffee).

Scoring: 10 points per letter with a combo multiplier every 10-streak, kill
bonuses by word length, and a final rank (D–S) from accuracy, WPM, and coffee
consumed.

## Run it

```sh
npm install
npm run dev      # dev server, prints a local URL
npm run build    # production build in dist/
npm run preview  # serve the production build
```

Requires Node 18+.

## Tech notes

- **Rendering:** Three.js PBR into a half-float HDR target, then bloom,
  ACES tone mapping, FXAA and a film-stock grade pass (lens distortion,
  edge chromatic aberration, teal/amber split tone, grain, vignette,
  red damage pulses and blood running down the lens). Every texture is
  painted into canvases at startup: granite setts with normal maps and a
  puddle map, six styles of canal-house facade (plaster, exposed brick,
  shutters, Venetian arches, lit interiors in an emissive map), dead skin,
  grave clothes, splatter decals.
- **The city:** a planar mirror pass reflects lamps, windows, lightning
  and the horde in the puddles and the canal, with raindrop ripples and
  wave distortion. A procedural sky dome draws fbm storm clouds drifting
  over a cratered moon, and forked lightning bolts throw shadows from
  the shadow-casting moon and strike lights. Terraces of canal houses
  with cornices, balconies and funnel chimneys line both banks, joined
  by humped stone bridges, striped mooring poles and rocking gondolas.
  Cast-iron lamps hang volumetric light cones in the rain, and a pool of
  real point lights follows the nearest ones. Each district crossfades
  its own fog, mist, rain, cloud cover and moon.
- **The horde:** multi-jointed ghouls (bloated, gaunt or ordinary) with
  patchy scalps, torn-away skull, gap-toothed jaws, ribs and office ties,
  a moonlit rim light and a hit flare on every letter. Killed ghouls burn
  away from a noise front in glowing embers. Instanced blood droplets,
  bouncing gibs, drying splatter decals, spark streaks, red mist and
  muzzle smoke. The Chancellor wears a pinstriped tailcoat and monocle,
  with a halo of gold coins in orbit.
- **The sidearm:** a bevelled pistol with green tritium night sights and
  a glowing amber battery cell, reflecting a small generated environment
  map, plus a lock-on reticle around the current target.
- **Frame rate:** instanced lamps and particles, merged zombie parts, and
  an automatic resolution step-down if frames run long (`?fixedq`
  disables it; `?debug` exposes the renderer for profiling).
- **Gameplay flourishes:** typed dismemberment (each letter strips a part,
  the last pops the head; the boss loses his hat, arms, and jaw one phrase
  at a time), ghouls that climb dripping out of the canal, five per-district
  atmospheres crossfaded along the rail, bullet-time on wave-clear and
  boss-final kills, a healing barista ghoul, and an idle-triggered attract
  mode where the game demos itself.
- **Audio:** all WebAudio synthesis — an adaptive four-layer score (sub
  pulse, bass, creeping arpeggio, hats and dissonance) that follows how
  close the horde is, layered gunshots that pitch up with your combo,
  splats, panned zombie groans, thunder, a low-HP heartbeat, boss roars, a
  generated convolution reverb, and a wind-drone-and-bell ambience.
- **No trademarks:** all names, words, phrases, and story are original.
