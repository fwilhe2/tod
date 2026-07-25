# Third-party assets

The game is playable with **no external assets at all** — the original
procedural ghouls are still there and are still the default. Everything listed
here powers the optional `?models` rendering path.

## `public/models/zombie.glb`

- **Source:** "Animated Zombie Pack" by [Quaternius](https://quaternius.com/packs/animatedzombie.html) (January 2018)
- **License:** [CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/) — public domain, no attribution required (credited here anyway)
- **Contains:** one skinned mesh (6,348 vertices, 41 bones, Mixamo-style bone
  naming) and five clips: `ZombieWalk`, `ZombieRun`, `ZombieBite`,
  `ZombieCrawl`, `ZombieIdle`.

Quaternius ships this pack as FBX/OBJ/Blend only. The `.glb` here was converted
offline with three.js' own `FBXLoader` → `GLTFExporter`; see
`tools/fbx2glb.mjs`. To regenerate it from a fresh download:

```sh
node tools/fbx2glb.mjs path/to/Zombie.fbx public/models/zombie.glb
```

### Deliberately *not* used

- **Mixamo** — free for commercial use, but redistributing the raw character and
  animation files is prohibited by its terms. That rules it out for a public
  repository, regardless of this project's own licence.
- **Sketchfab "free" models** — usually CC-BY, not CC0. Attribution-encumbered
  assets are avoidable here, so they are avoided.
