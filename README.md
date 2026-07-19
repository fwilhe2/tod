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

- **Rendering:** Three.js with an HDR bloom post-processing pipeline (ACES
  tone mapping + UnrealBloomPass) — fog-drenched night canal with rain,
  lightning, drifting ground mist and embers; procedural multi-jointed
  ghouls (elbows, knees, swinging jaws, clawed fingers, glowing eyes,
  wounds, fluttering rags) with shamble/lunge/death animations; a
  first-person sidearm in a gloved hand with recoil, muzzle flash and
  ejected shell casings; visible tracer rounds, impact sparks, shockwave
  rings and score popups per keystroke; canvas-texture word labels as
  billboards, vertex-animated canal water, window-lit facades from
  generated textures.
- **Audio:** all WebAudio synthesis — layered gunshots that pitch up with
  your combo, splats, panned zombie groans, thunder, a low-HP heartbeat,
  boss roars, a generated convolution reverb, and a wind-drone-and-bell
  ambience.
- **No trademarks:** all names, words, phrases, and story are original.
