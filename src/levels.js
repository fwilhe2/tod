// Campaign layout: three stages of three districts each, every stage ending in
// a boss. The rail advances one block per fight, so the whole run is one
// continuous walk up the canal.
//
// mood: index into world.js MOODS.  mix: spawn weights per ghoul kind.
// pickups: how many power-up canisters drift through the district.

export const STAGES = [
  {
    name: { en: 'THE QUAYSIDE', de: 'DER KAI' },
    areas: [
      { mood: 0, tier: 0, count: 10, simult: 2, speed: [0.65, 0.9], pickups: 1,
        mix: { walker: 1 }, sub: { en: 'THEY CAN SMELL TYPOS', de: 'SIE RIECHEN TIPPFEHLER' } },
      { mood: 1, tier: 1, count: 12, simult: 2, speed: [0.7, 0.95], pickups: 1,
        mix: { walker: 0.75, runner: 0.25 }, sub: { en: 'SOME OF THEM RUN', de: 'MANCHE RENNEN' } },
      { mood: 2, tier: 1, count: 14, simult: 3, speed: [0.75, 1.0], pickups: 2,
        mix: { walker: 0.6, runner: 0.2, crawler: 0.2 }, sub: { en: 'WATCH YOUR ANKLES', de: 'ACHTE AUF DEINE KNÖCHEL' } },
    ],
    boss: 'gondolier', bossMood: 6, bossHP: 4,
  },
  {
    name: { en: 'THE NIGHT MARKET', de: 'DER NACHTMARKT' },
    areas: [
      { mood: 3, tier: 1, count: 14, simult: 3, speed: [0.8, 1.05], pickups: 2,
        mix: { walker: 0.5, runner: 0.2, crawler: 0.15, bloater: 0.15 }, sub: { en: 'BLOATERS POP. STAND BACK.', de: 'BLÄHER PLATZEN. ABSTAND!' } },
      { mood: 7, tier: 2, count: 15, simult: 3, speed: [0.8, 1.1], pickups: 2,
        mix: { walker: 0.45, runner: 0.2, bloater: 0.15, brute: 0.2 }, sub: { en: 'THE BIG ONES HIT TWICE', de: 'DIE GROSSEN SCHLAGEN DOPPELT' } },
      { mood: 4, tier: 2, count: 16, simult: 3, speed: [0.85, 1.15], pickups: 2,
        mix: { walker: 0.4, runner: 0.25, crawler: 0.15, bloater: 0.1, brute: 0.1 }, sub: { en: 'STORM WARNING', de: 'STURMWARNUNG' } },
    ],
    boss: 'chef', bossMood: 8, bossHP: 5,
  },
  {
    name: { en: 'THE COUNTING HOUSE', de: 'DAS KONTOR' },
    areas: [
      { mood: 9, tier: 3, count: 15, simult: 3, speed: [0.9, 1.2], pickups: 2,
        mix: { walker: 0.45, runner: 0.2, crawler: 0.15, bloater: 0.1, brute: 0.1 }, sub: { en: 'ASH IN THE AIR', de: 'ASCHE IN DER LUFT' } },
      { mood: 2, tier: 3, count: 16, simult: 4, speed: [0.95, 1.25], pickups: 2,
        mix: { walker: 0.35, runner: 0.3, crawler: 0.15, bloater: 0.1, brute: 0.1 }, sub: { en: 'LIGHTS OUT', de: 'LICHT AUS' } },
      { mood: 10, tier: 4, count: 16, simult: 3, speed: [1.0, 1.3], pickups: 3,
        mix: { walker: 0.4, runner: 0.2, crawler: 0.1, bloater: 0.15, brute: 0.15 }, sub: { en: 'THE LAST BLOCK', de: 'DER LETZTE BLOCK' } },
    ],
    boss: 'chancellor', bossMood: 5, bossHP: 6,
  },
];

// ghoul kinds — the attract roster and the spawner both read this
export const KINDS = {
  walker: { speed: 1, tier: 0, en: ['WALKER', 'SLOW, STUPID, PERSISTENT.'], de: ['WANDLER', 'LANGSAM, DUMM, HARTNÄCKIG.'] },
  runner: { speed: 1.9, tier: -1, en: ['RUNNER', 'FAST. SHORT WORDS. NO MANNERS.'], de: ['RENNER', 'SCHNELL. KURZE WÖRTER. KEINE MANIEREN.'] },
  crawler: { speed: 0.75, tier: 0, en: ['CRAWLER', 'LOST ITS LEGS. NOT ITS APPETITE.'], de: ['KRIECHER', 'BEINE WEG. HUNGER NICHT.'] },
  bloater: { speed: 0.7, tier: 0, en: ['BLOATER', 'POPS ON DEATH. TAKES FRIENDS ALONG.'], de: ['BLÄHER', 'PLATZT IM TOD. NIMMT FREUNDE MIT.'] },
  brute: { speed: 0.6, tier: 1, en: ['BRUTE', 'LONG WORDS. HITS FOR TWO HEARTS.'], de: ['KOLOSS', 'LANGE WÖRTER. TRIFFT FÜR ZWEI HERZEN.'] },
  coffee: { speed: 1, tier: 0, en: ['BARISTA', 'AMBER EYES. DROP IT FOR A HEART.'], de: ['BARISTA', 'BERNSTEINAUGEN. GIBT EIN HERZ ZURÜCK.'] },
};

export const PICKUPS = {
  medkit: { color: 0xff4a4a, css: '#ff6a6a', en: 'MEDKIT +1 HEART', de: 'MEDIKIT +1 HERZ' },
  bomb: { color: 0xffa020, css: '#ffb040', en: 'NAPALM — CLEARS THE STREET', de: 'NAPALM — RÄUMT DIE STRASSE' },
  freeze: { color: 0x60d8ff, css: '#80e0ff', en: 'FREEZE — SLOWS THE HORDE', de: 'FROST — BREMST DIE HORDE' },
  double: { color: 0xc070ff, css: '#d090ff', en: 'DOUBLE SCORE', de: 'DOPPELTE PUNKTE' },
};

// flat list of every fight on the rail, in order
export const FIGHTS = STAGES.flatMap((s, si) => [
  ...s.areas.map((a, ai) => ({ type: 'area', stage: si, area: ai, ...a })),
  { type: 'boss', stage: si, boss: s.boss, mood: s.bossMood, hp: s.bossHP },
]);
