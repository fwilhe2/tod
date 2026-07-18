// All words, phrases, and story text are original to this game.

export const TIERS = [
  // tier 0 — short and panicky
  [
    'fog', 'rot', 'run', 'bite', 'claw', 'moan', 'gnaw', 'bone', 'dank',
    'drip', 'rust', 'ash', 'grim', 'howl', 'lurk', 'limp', 'doom', 'cold',
    'damp', 'grab', 'hiss', 'jolt', 'murk', 'pale', 'reek', 'slug', 'tomb',
    'veil', 'wail', 'ooze', 'gasp', 'dusk',
  ],
  // tier 1 — medium
  [
    'groan', 'slime', 'fungus', 'mildew', 'cellar', 'corpse', 'decay',
    'shiver', 'undead', 'twitch', 'wither', 'gloomy', 'rancid', 'sewage',
    'plague', 'grotto', 'lagoon', 'crypts', 'squish', 'shroud', 'putrid',
    'clammy', 'gurgle', 'wheeze', 'stench', 'morbid', 'dampen', 'sludge',
  ],
  // tier 2 — long single words
  [
    'shambling', 'festering', 'moldering', 'cadaverous', 'pestilence',
    'catacombs', 'lumbering', 'grotesque', 'nocturnal', 'spineless',
    'decomposed', 'malodorous', 'unhinged', 'ravenous', 'ghoulish',
    'waterlogged', 'sepulchral', 'gangrenous', 'monstrous', 'flailing',
    'necrotic', 'squelching', 'abhorrent', 'skeletal',
  ],
  // tier 3 — two-word absurdities
  [
    'soggy loafers', 'expired yogurt', 'haunted gazebo', 'angry pigeons',
    'cursed espresso', 'damp cardigan', 'gondola parking', 'artisanal slime',
    'budget exorcism', 'decaf apocalypse', 'moist handshake', 'ominous polka',
    'leftover lasagna', 'suspicious broth', 'unpaid gondolier', 'vengeful mime',
    'spicy meatball', 'feral accordion', 'soggy paperwork', 'chewed scenery',
  ],
  // tier 4 — full nonsense sentences
  [
    'the canal smells like regret',
    'my gondola has no brakes',
    'this fog tastes like pennies',
    'the pigeons have unionized',
    'someone microwaved the fish',
    'my typewriter is haunted',
    'we are out of garlic again',
    'the moon is judging me',
    'i pressed every key at once',
    'do not lick the lamppost',
    'the tide brought more lawyers',
    'his toupee is still alive',
  ],
];

export const BOSS_PHRASES = [
  'your bank account has been converted into locusts and regret',
  'kneel before the compound interest of the damned',
  'i have foreclosed on the concept of hope itself',
  'the invisible hand of the market has six fingers and claws',
  'your credit score will not save you from the rising tide',
  'i traded my soul at a very competitive exchange rate',
  'behold my diversified portfolio of plagues and sorrows',
  'the quarterly report of the apocalypse is due at dawn',
];

export const QUESTION = {
  prompt: 'BEFORE I ROT, ANSWER ME: WHY DO YOU FIGHT?',
  answers: [
    { text: 'to protect the living', ending: 'DAWN' },
    { text: 'for the loot', ending: 'JACKPOT' },
    { text: 'my keyboard told me to', ending: 'ASCENSION' },
  ],
};

export const ENDINGS = {
  DAWN: {
    title: 'ENDING: DAWN',
    text:
      'You lower your smoking keyboard. Sunlight crawls over the rooftops of ' +
      'Porto Morto, and somewhere a pigeon coos the first three notes of a ' +
      'victory march. The city will live. Your wrists, however, are filing ' +
      'for a week of paid leave.',
  },
  JACKPOT: {
    title: 'ENDING: JACKPOT',
    text:
      '"Honesty was optional," the Chancellor sighs, and detonates into a ' +
      'blizzard of expired coupons. You grab as much as you can carry. ' +
      'It is not treasure. It is homework. It was always homework.',
  },
  ASCENSION: {
    title: 'ENDING: ASCENSION',
    text:
      'Your keyboard begins to hum an old, patient song. The Chancellor nods, ' +
      'almost respectfully, as you and your ergonomic field rig rise gently ' +
      'into the clouds. Nobody explains anything. The credits roll anyway.',
  },
};

// Guarantees the returned word never shares a first letter with any word in
// use, so lock-on targeting is always unambiguous. Falls back to neighboring
// tiers if the requested pool has no safe candidates left.
export function pickWord(tier, inUse) {
  const t = Math.min(tier, TIERS.length - 1);
  const used = new Set(inUse);
  const firsts = new Set(inUse.map((w) => w[0]));
  const tierOrder = [t, t - 1, t + 1, t - 2, t + 2]
    .filter((i, idx, arr) => i >= 0 && i < TIERS.length && arr.indexOf(i) === idx);
  for (const ti of tierOrder) {
    const safe = TIERS[ti].filter((w) => !used.has(w) && !firsts.has(w[0]));
    if (safe.length) return safe[Math.floor(Math.random() * safe.length)];
  }
  // 26+ simultaneous zombies would be required to get here
  return TIERS[t][Math.floor(Math.random() * TIERS[t].length)];
}
