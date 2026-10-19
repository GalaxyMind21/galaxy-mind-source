// BITCOIN KART · data.js
// Pure data: roster, tracks, items, copy, adventure gating. NO DOM access,
// NO imports with side effects: scripts/test-bitcoin-kart.ts imports this
// file directly and asserts the invariants (11 roster slots, satoshi locked,
// 12 events, music keys, copy house rules: no em dashes, no "88").

export const GAME_TITLE = "BITCOIN KART";
export const TAGLINE = "One chair. Ten racers. No second best.";
export const SHARE_URL = "https://galaxymind.space/bitcoin-kart";
export const NS = "gm:bitcoin-kart:";

// ---------------------------------------------------------------------------
// ROSTER · 5 bitcoiners + 5 anti-bitcoiners unlocked, Satoshi locked.
// stats: speed / accel / handling / weight / itemLuck (0..10)
// ---------------------------------------------------------------------------

export const ROSTER = [
  {
    id: "saylor",
    displayName: "Michael Saylor",
    handle: "@saylor",
    side: "btc",
    bio: "Digital capital. Decades, not days. The chair does not flinch.",
    kartName: "The One Chair",
    palette: { body: "#17171B", accent: "#F7931A" },
    stats: { speed: 9, accel: 5, handling: 4, weight: 9, itemLuck: 5 },
    signature: "One Chair lasts longer and bumps harder while active.",
    sig: { chairMult: 1.5, chairBump: 1.35, laserEyes: "red" },
    ai: { skill: 0.85, aggr: 0.45, boostHappy: 0.35 },
    taunts: [
      "There is no second best.",
      "Bitcoin is digital energy.",
      "Digital capital takes the lead.",
      "Never sell. Never lift.",
      "Influence is earned. Not granted.",
      "The free market already solved it.",
      "Right to bear arms. And first.",
      "I race in decades, not laps.",
      "The halls of eternity hate sellers.",
      "Volatility is vibration. Sit deeper.",
      "The chair does not flinch.",
      "You do not short a throne.",
      "Cyber hornets incoming.",
    ],
    unlocked: true,
  },
  {
    id: "phong",
    displayName: "Phong Le",
    handle: "@phongle",
    side: "btc",
    bio: "Mission control on wheels. Bank rails to kart rails. Adoption is early.",
    kartName: "Mission Control",
    palette: { body: "#1E3A5F", accent: "#F7931A" },
    stats: { speed: 8, accel: 7, handling: 6, weight: 6, itemLuck: 6 },
    signature: "Extra grip on Corporate Cup asphalt.",
    sig: { corporateGrip: 1.2 },
    ai: { skill: 0.8, aggr: 0.4, boostHappy: 0.5 },
    taunts: [
      "Bitcoin is freedom. You are not.",
      "Bank adoption arrived. You did not.",
      "We are not going anywhere.",
      "Apex asset. Apex line.",
      "Markets do not move in straight lines. I do.",
      "Mission control, we are passing.",
      "Execution is the strategy.",
      "The rails are settled. So is this race.",
      "Adoption is early. My apex is not.",
      "Smooth is fast. Fast is smooth.",
      "No drama. Just throughput.",
      "Corporate grip. Personal lead.",
    ],
    unlocked: true,
  },
  {
    id: "wizard",
    displayName: "The Bitcoin Wizard",
    handle: "@AdamBLiv",
    side: "btc",
    bio: "Truth money on a spell-scooter. Finance is astrology for suits.",
    kartName: "Spell Scooter",
    palette: { body: "#4338CA", accent: "#312E81" },
    stats: { speed: 7, accel: 6, handling: 7, weight: 5, itemLuck: 9 },
    signature: "Best item luck on the grid. Sats grant a tiny alchemy boost.",
    sig: { satBoost: true, rareLuck: 1.6 },
    ai: { skill: 0.72, aggr: 0.5, boostHappy: 0.55 },
    taunts: [
      "We're back, kids.",
      "About to rip your face off.",
      "Nature is healing. You are not.",
      "Assassin of truth, incoming.",
      "Dust off the bullishness, kids.",
      "You are not stacking fast enough.",
      "Finance is astrology. This is alchemy.",
      "Declaw the bears.",
      "Truth money, coming through.",
      "The spell is twenty one million.",
      "Your kart runs on hopium.",
      "Abracadabra, position swap.",
    ],
    unlocked: true,
  },
  {
    id: "mallers",
    displayName: "Jack Mallers",
    handle: "@jackmallers",
    side: "btc",
    bio: "High voltage. Lightning fast, zero conf needed on the straights.",
    kartName: "Bolt Runner",
    palette: { body: "#F5F5F7", accent: "#22D3EE" },
    stats: { speed: 8, accel: 9, handling: 6, weight: 4, itemLuck: 6 },
    signature: "Laser Eyes boosts hit harder. Gold off-road hits him harder.",
    sig: { laserMult: 1.3, goldWeak: true, laserEyes: "cyan" },
    ai: { skill: 0.78, aggr: 0.55, boostHappy: 0.9 },
    taunts: [
      "Do not ask Bitcoin to be gentle.",
      "Crypto goes to zero. Bitcoin does not.",
      "Hero's journey. My lap.",
      "Fiat is debt and war. Opt out.",
      "The best money wins.",
      "Volatility is inevitable. Losing is not.",
      "Instant settlement, buddy.",
      "Lightning does strike twice.",
      "High voltage, low latency.",
      "Your fees are showing.",
      "Zero confs, full send.",
      "Channels open, throttle open.",
      "Have fun staying last.",
    ],
    unlocked: true,
  },
  {
    id: "bukele",
    displayName: "Nayib Bukele",
    handle: "@nayibbukele",
    side: "btc",
    bio: "Sovereign stack, beach nation, volcano energy. Surf the dip.",
    kartName: "Volcano Board",
    palette: { body: "#1B4F72", accent: "#F5F5F7" },
    stats: { speed: 8, accel: 6, handling: 7, weight: 6, itemLuck: 6 },
    signature: "Sand and rocky ground never slow him. Big air on jumps.",
    // "rock" is One Chair Peak's off-road surface (track.js theme set:
    // sand/grass/wet/snow/city/marble/rock/gold · there is no "volcanic")
    sig: { surfaceImmune: ["sand", "rock"], airBonus: 1.3 },
    ai: { skill: 0.76, aggr: 0.45, boostHappy: 0.5 },
    taunts: [
      "Buying twenty one. Passing one.",
      "They called it corruption. We called it first.",
      "Bitcoin up. You down.",
      "Ignoring the naysayers. Winning.",
      "Buy the dips. Beat the field.",
      "One coin a day. Still faster.",
      "Legal tender on this racing line.",
      "Sovereign lines only.",
      "Volcano power in the engine bay.",
      "Surf the dip, pass on the rip.",
      "Adopting first place as law.",
      "The beach bows to no bear.",
    ],
    unlocked: true,
  },
  {
    id: "satoshi",
    displayName: "Satoshi Nakamoto",
    handle: "",
    side: "btc",
    bio: "The ghost of the protocol. Runs quiet. Runs forever.",
    kartName: "Genesis Runner",
    palette: { body: "#B9BDD3", accent: "#2A2A31" },
    // maxed across the board (operator decision 2026-07-18): the locked
    // reward character IS overpowered · he wrote the protocol. Exempt
    // from the balance band (sim-kart-balance reports, never gates him).
    stats: { speed: 10, accel: 10, handling: 10, weight: 10, itemLuck: 10 },
    signature: "Perfectly balanced. The protocol needs no signature.",
    sig: {},
    ai: { skill: 0.92, aggr: 0.3, boostHappy: 0.5 },
    taunts: [
      "...",
      "e9 8f 01",
      "...",
      "21e6",
      "...",
      "running.",
      "running code.",
      "peer to peer.",
    ],
    unlocked: false,
    lockHint: "Finish the Orange Circuit. Recover the signal.",
    // ALL THREE required: corporate door opened + Schiff beaten in the
    // final boss race + 12 Orange Balloons.
    unlock: { corporateAccess: true, beatSchiff: true, balloons: 12 },
  },
  {
    id: "schiff",
    displayName: "Peter Schiff",
    handle: "",
    side: "fiat",
    bio: "Gold-bar dragster. Five thousand years of momentum, allegedly.",
    kartName: "Bullion Dragster",
    palette: { body: "#4A3B2A", accent: "#F5C542" },
    stats: { speed: 7, accel: 6, handling: 5, weight: 9, itemLuck: 5 },
    signature: "Gold off-road never slows him. Lightning rattles him. Final boss.",
    sig: { surfaceImmune: ["gold"], boltWeak: true, finalBoss: true },
    ai: { skill: 0.8, aggr: 0.6, boostHappy: 0.3, campsGold: true },
    taunts: [
      "Got gold? Got first.",
      "Digital fool's gold. Solid lead.",
      "Greater fool, meet greater speed.",
      "Not digital gold. Just last place.",
      "You will regret not selling.",
      "Gold has been money for five thousand years!",
      "This race is going to zero.",
      "Digital tulips, all of you.",
      "You cannot eat a kart.",
      "I warned everyone about this track.",
      "Buy gold. And my newsletter.",
      "I called the crash. Again.",
    ],
    unlocked: true,
  },
  {
    id: "dimon",
    displayName: "Jamie Dimon",
    handle: "",
    side: "fiat",
    bio: "Bank vault on wheels. Heavier than your conviction.",
    kartName: "Vault Kart",
    palette: { body: "#1E3A5F", accent: "#8E8E98" },
    stats: { speed: 7, accel: 5, handling: 5, weight: 10, itemLuck: 4 },
    signature: "Finds shields more often. Rams like a balance sheet.",
    sig: { shieldBias: 2.0, ramBonus: 1.3 },
    ai: { skill: 0.7, aggr: 0.75, boostHappy: 0.3 },
    taunts: [
      "It is a pet rock with a spoiler.",
      "Hyped-up fraud on four wheels.",
      "It does nothing. I do first place.",
      "I will still ban you from the podium.",
      "The vault yields to no one.",
      "Compliance check, coming through.",
      "Worthless asset. Useful speed bump.",
      "My branch network owns this track.",
      "I am done talking about you.",
      "Fraud, theater, and a bad apex.",
      "Blockchain is fine. You are not.",
      "The bank always collects.",
    ],
    unlocked: true,
  },
  {
    id: "warren",
    displayName: "Elizabeth Warren",
    handle: "",
    side: "fiat",
    bio: "Hearing-room battle-kart. Building an anti-overtake army.",
    kartName: "Oversight One",
    palette: { body: "#7C2D3E", accent: "#EFE6D0" },
    stats: { speed: 7, accel: 6, handling: 6, weight: 7, itemLuck: 7 },
    signature: "Regulatory hazards appear in her hands more often.",
    sig: { hammerBias: 1.8, headlineBias: 1.4 },
    ai: { skill: 0.72, aggr: 0.7, boostHappy: 0.4 },
    taunts: [
      "Building an anti-overtake army.",
      "No crypto profits on my track.",
      "Not a playground. A race. I win.",
      "Enough is enough. And I am first.",
      "Working families deserve first place.",
      "I have a plan for that overtake.",
      "This lap is now under review.",
      "The rules of the road apply to you.",
      "Hearing adjourned. Hammer time.",
      "Your drift lacks disclosure.",
      "Point of order: I am passing.",
      "Read the fine print. I wrote it.",
    ],
    unlocked: true,
  },
  {
    id: "buffett",
    displayName: "Warren Buffett",
    handle: "",
    side: "fiat",
    bio: "Value-kart with a cherry soda holster. Rat poison, squared wheels.",
    kartName: "Value Wagon",
    palette: { body: "#8B7355", accent: "#E5484D" },
    stats: { speed: 7, accel: 5, handling: 6, weight: 9, itemLuck: 5 },
    signature: "Sturdy defense. Digital Laser Eyes barely move him.",
    sig: { shieldBias: 1.5, laserMult: 0.8 },
    ai: { skill: 0.74, aggr: 0.4, boostHappy: 0.25 },
    taunts: [
      "Rat poison. Squared.",
      "Stay in your circle of competence.",
      "Wonderful businesses. Fair speeds.",
      "My holding period is this whole race.",
      "Cherry soda and compounding, kid.",
      "I do not race what I do not understand.",
      "Our favorite hold is forever. And first.",
      "Mr. Market is wrong. I am not.",
      "Price is what you pay. Place is first.",
      "No moat? No podium.",
      "I buy when others spin out.",
      "Patience is a competitive advantage.",
    ],
    unlocked: true,
  },
  {
    id: "cuban",
    displayName: "Mark Cuban",
    handle: "",
    side: "fiat",
    bio: "Shark-tank energy in a jersey-blue rocket. Hot takes at full throttle.",
    kartName: "Maverick GT",
    palette: { body: "#0A66C2", accent: "#F5F5F7" },
    stats: { speed: 8, accel: 7, handling: 6, weight: 6, itemLuck: 6 },
    signature: "Hot-take items land in his slot more often.",
    sig: { fudBias: 1.8, headlineBias: 1.8 },
    ai: { skill: 0.78, aggr: 0.65, boostHappy: 0.6 },
    taunts: [
      "It's a bitcoin play. And a pass.",
      "Twenty one million. One first place.",
      "Regulators choke. I don't.",
      "Mint it. Print it. Pass you.",
      "Bitcoin lost the plot. I found first.",
      "Hot take incoming.",
      "I will say what I think at any speed.",
      "For that overtake? I am out. Kidding.",
      "Hail Mary on the inside line.",
      "Flip the board, flip the grid.",
      "Shark in the draft. You are bait.",
      "I am in. You are done.",
    ],
    unlocked: true,
  },
];

export const DEFAULT_DRIVER = "saylor";

// 100%-completion gilt for Satoshi · swapped over his silver-ghost palette
// once every balloon is collected and every level cleared (main.js goldify)
export const GOLD_SATOSHI = { body: "#F5C542", accent: "#7A5A12" };

// Boss characters (not on the select grid · special 1v1 rivals).
export const BOSSES = {
  bear2014: {
    id: "bear2014",
    displayName: "The Bear of 2014",
    side: "fiat",
    kartName: "Frost Sled",
    palette: { body: "#9CD6E8", accent: "#F5F5F7" },
    stats: { speed: 7, accel: 6, handling: 6, weight: 8, itemLuck: 5 },
    ai: { skill: 0.82, aggr: 0.7, boostHappy: 0.4 },
    taunts: [
      "WINTER LASTS FOREVER.",
      "IT IS GOING TO ZERO.",
      "I BURIED STRONGER HANDS THAN YOURS.",
      "FEEL THE FROST, STACKER.",
      "NO SPRING FOR PAPER HANDS.",
      "THE BEAR MARKET NEVER LEFT.",
      "YOUR BAG IS FROZEN.",
      "HIBERNATE IN LAST PLACE.",
    ],
  },
  headline: {
    id: "headline",
    displayName: "The Headline",
    side: "fiat",
    kartName: "Breaking News Van",
    palette: { body: "#F5F5F7", accent: "#E5484D" },
    stats: { speed: 7, accel: 7, handling: 6, weight: 7, itemLuck: 6 },
    ai: { skill: 0.84, aggr: 0.75, boostHappy: 0.5 },
    taunts: [
      "BITCOIN DECLARED DEAD. AGAIN.",
      "SOURCES SAY YOU FINISH LAST.",
      "EXPERTS AGREE: IT IS OVER.",
      "THIS JUST IN: ME, IN FRONT.",
      "BREAKING: YOU GOT PASSED.",
      "OBITUARY WRITES ITSELF.",
      "CLICKBAIT IN THE APEX.",
      "FOLLOW FOR MORE COPE.",
    ],
  },
};

// ---------------------------------------------------------------------------
// ITEMS · classic kart-racer grammar, Bitcoin nouns.
// ---------------------------------------------------------------------------

export const ITEMS = {
  peel: { name: "Paper Hands Peel", chip: "PEEL", color: "#F6C453", desc: "Drop it behind. Weak hands spin on it." },
  fud: { name: "FUD Tweet", chip: "FUD", color: "#9999A1", desc: "A flying FUD scroll. Fires straight, bounces once." },
  ratio: { name: "Ratio Missile", chip: "RATIO", color: "#22D3EE", desc: "Homes in on the kart ahead. Blue-check sparkles." },
  hammer: { name: "Regulatory Hammer", chip: "GAVEL", color: "#E5484D", desc: "A sky gavel finds whoever is in first. Long telegraph." },
  laser: { name: "Laser Eyes", chip: "LASER", color: "#FB923C", desc: "Eye-flash turbo. Focus forward." },
  chair: { name: "One Chair", chip: "CHAIR", color: "#F7931A", desc: "Invincible. Faster. The chair moves for no one." },
  bolt: { name: "Halving Bolt", chip: "BOLT", color: "#FFD166", desc: "The field slows. Supply shock on wheels." },
  headline: { name: "Media Headline", chip: "NEWS", color: "#D8DBE2", desc: "A fake pickup. BITCOIN DEAD placard says otherwise." },
  shield: { name: "STRC Shield", chip: "SHLD", color: "#4ADE80", desc: "Stretch armor absorbs one hit." },
  pill: { name: "Orange Pill", chip: "PILL", color: "#F7931A", desc: "Steal an item from the kart ahead and pocket sats." },
  goldbar: { name: "Gold Bar", chip: "GOLD", color: "#F5C542", desc: "A heavy brick. Thrown like an argument from 1971." },
};

// Roulette weights by position bucket. lead: ranks 1-2, mid: 3-5, tail: 6-8.
export const ITEM_WEIGHTS = {
  lead: { peel: 3, fud: 2, headline: 2, shield: 2, laser: 0.7, goldbar: 0.4 },
  mid: { fud: 2, ratio: 2, laser: 2, peel: 1, shield: 1.2, bolt: 0.5, pill: 0.6, hammer: 0.4, goldbar: 0.3 },
  tail: { ratio: 2.4, laser: 2.6, hammer: 1.4, bolt: 1.2, chair: 0.9, pill: 1.1, shield: 0.6, goldbar: 0.3 },
};

// ---------------------------------------------------------------------------
// WORLDS + EVENTS · 12 events across three worlds plus finale.
// Track splines are control points [x, y, z] (Catmull-Rom, closed loop).
// t values are 0..1 along the loop. side is lateral: -1 left, +1 right.
// ---------------------------------------------------------------------------

export const WORLDS = [
  { id: "genesis", name: "Genesis World", door: "Genesis Gate", cost: 0, tag: "Where it all began, one block at a time" },
  { id: "neon", name: "Neon World", door: "Neon Gate", cost: 5, tag: "Number go up, sense go sideways" },
  { id: "corporate", name: "Corporate World", door: "Corporate Gate", cost: 10, tag: "Balance sheets discover an exit" },
];

export const CUPS = [
  { id: "genesis", name: "Genesis Cup", events: ["pizza-beach", "genesis-circuit", "gox-docks", "winter-2014"] },
  { id: "neon", name: "Neon Cup", events: ["blocksize-fog", "euphoria-neon", "printer-runway", "obituary-alley"] },
  { id: "corporate", name: "Corporate Cup", events: ["glass-tower-loop", "etf-dawn", "one-chair-peak", "schiff-gold-mine"] },
];

export const CUP_POINTS = [10, 8, 6, 4, 3, 2, 1, 0];

// Adventure gating (balloon costs). Boss gates also need the world's three
// tracks to hold at least one balloon each.
export const GATES = {
  "winter-2014": { balloons: 3, world: "genesis" },
  "obituary-alley": { balloons: 8, world: "neon" },
  "schiff-gold-mine": { balloons: 12, world: "corporate" },
};

export const TRACKS = [
  {
    id: "pizza-beach",
    name: "Pizza Beach",
    world: "genesis",
    music: "genesis",
    laps: 3,
    width: 17,
    ridge: 16,
    theme: "beach",
    hillAmp: 1.6, // map pass 2026-07-16 · terrain drama, road apron untouched
    island: 188, // set-piece pass 2026-07-18: shoreline pulled in from the
    // theme default 210 so the north arc runs right along the water and the
    // open coastal edge below actually drops toward ocean, not distant sand
    intro: "Wide sand, warm water, and the most expensive pizza in history.",
    tip: "Boost into the pizza ramp for hang time. The coast road has no rail, only ocean.",
    pts: [
      [0, 0.4, 0], [4, 0.4, 62], [2, 0.6, 118], [26, 1.2, 172], [86, 3.2, 208],
      [152, 1.4, 214], [204, 2.6, 178], [216, 4.2, 118], [196, 5.6, 62],
      [232, 2.2, 6], [236, 3.0, -62], [188, 2.2, -116], [118, 1.0, -138],
      [48, 0.5, -122], [4, 0.4, -66],
    ],
    // epic-air 2026-07-18: MEGA coastal launch (headland pts 7..8 into the
    // h 7.5 x1.22 lip, 0.465 pad feed) · worst-case landings reach ~0.71,
    // so hazard 2 and the third box row sit past that. Coastal window
    // keeps its inland wall.
    boost: [{ t: 0.345, side: 0 }, { t: 0.465, side: 0 }, { t: 0.62, side: 0.25 }, { t: 0.88, side: -0.2 }],
    jumps: [{ t: 0.52, h: 7.5, boost: 1.22 }, { t: 0.84, h: 2.6 }],
    // THE SHARK STRAIT (mythic pass 2026-07-21): the big jump crosses a
    // sea inlet carved through the island · no glow river, the ocean
    // itself floods the gap and the fins move in
    chasms: [{ t0: 0.46, t1: 0.585, w: 30, depth: 16, glow: null }],
    // THE DECK IS GONE: launch off the lip, fly the open strait, land on
    // the far side · come up short and the fins are waiting
    gaps: [{ t0: 0.523, t1: 0.558 }],
    hazards: [{ t0: 0.17, t1: 0.33, side: "out" }, { t0: 0.73, t1: 0.8, side: "out" }, { t0: 0.52, t1: 0.575, side: "out" }, { t0: 0.52, t1: 0.575, side: "in" }],
    boxes: [0.12, 0.38, 0.71, 0.9],
    sats: [
      { t0: 0.05, t1: 0.11, side: 0.5 }, { t0: 0.3, t1: 0.36, side: 0 },
      { t0: 0.44, t1: 0.505, side: -0.55 }, { t0: 0.7, t1: 0.78, side: 0.5 },
    ],
    props: [
      // the island volcano breathes embers over the strait
      { type: "volcano", t: 0.7, side: 6, scale: 2.6, y: 1.2, emit: "embers" },
      { type: "bearFin", t: 0.53, side: 0.6, scale: 2.4, y: -6.4 },
      { type: "bearFin", t: 0.539, side: -0.9, scale: 2.8, y: -6.4 },
      { type: "bearFin", t: 0.49, side: 2.6, scale: 2.2, y: -6.0 },
      { type: "bearFin", t: 0.53, side: -2.8, scale: 2.6, y: -6.5 },
      { type: "bearFin", t: 0.56, side: 2.9, scale: 2.0, y: -5.4 },
      { type: "pizzaSlice", t: 0.55, side: -6, scale: 8, y: -2 },
      { type: "bearFin", t: 0.27, side: -5.6, scale: 2.6, y: -4.1 },
      { type: "bearFin", t: 0.31, side: -5.6, scale: 2.2, y: -2.9 },
      { type: "bearFin", t: 0.74, side: -5.6, scale: 3.0, y: -3.0 },
      // set-piece pass 2026-07-18: lagoon falls scaled into a hero landmark
      // and moved to 0.565 so the hero-jump flight stares straight at them,
      // layered behind the lighthouse at 0.58
      { type: "waterfall", t: 0.565, side: -4.6, scale: 2.1 },
      // floats in the water off the rail-less edge (the window's "out" side
      // resolves to NEGATIVE lateral here · review 2026-07-18)
      { type: "buoy", t: 0.26, side: -3 },
      { type: "rock", t: 0.23, side: 4.6, scale: 2.2 }, { type: "rock", t: 0.52, side: -4.8, scale: 2.6 },
      { type: "palm", t: 0.61, side: 4.2 }, { type: "palm", t: 0.63, side: 4.9 },
      { type: "pizzaSlice", t: 0.44, side: 2.6, scale: 2.2 },
      { type: "lighthouse", t: 0.58, side: -2.8, scale: 1.4 },
      { type: "palm", t: 0.06, side: 1.8 }, { type: "palm", t: 0.1, side: -1.9 },
      { type: "palm", t: 0.2, side: 2.2 }, { type: "palm", t: 0.26, side: -2.0 },
      { type: "palm", t: 0.35, side: 1.7 }, { type: "palm", t: 0.5, side: -2.2 },
      { type: "palm", t: 0.68, side: 2.1 }, { type: "palm", t: 0.75, side: -1.8 },
      { type: "palm", t: 0.82, side: 2.4 }, { type: "palm", t: 0.94, side: -2.1 },
      { type: "buoy", t: 0.15, side: 3.5 }, { type: "buoy", t: 0.55, side: 3.8 },
      { type: "buoy", t: 0.7, side: -3.4 },
      { type: "rock", t: 0.4, side: -2.6 }, { type: "rock", t: 0.86, side: 2.9 },
      { type: "rock", t: 0.31, side: 2.7 },
      { type: "pizzaOven", t: 0.3, side: -1.7 }, { type: "pizzaOven", t: 0.88, side: -1.6 },
      { type: "palm", t: 0.44, side: -1.8 },
      { type: "balloon", t: 0.33, side: -1.6 }, { type: "balloon", t: 0.77, side: 1.5 },
      // K14 crowds: every crowdA MUST carry the IDENTICAL {t, side, y, rot,
      // scale} tuple as its grandstand · propModel is deterministic, so the
      // matching tuple seats the spectators on the benches. Jump stands get
      // explicit rot (probed to face the lip); y values probed against the
      // built terrain (kart-epic-terrain convention · never guessed).
      { type: "grandstand", t: 0.982, side: 2, y: -0.2 }, { type: "crowdA", t: 0.982, side: 2, y: -0.2 },
      { type: "grandstand", t: 0.994, side: -2, y: -0.2 }, { type: "crowdA", t: 0.994, side: -2, y: -0.2 },
      { type: "grandstand", t: 0.425, side: 2, y: -0.4, rot: 3.13 }, { type: "crowdA", t: 0.425, side: 2, y: -0.4, rot: 3.13 },
      { type: "flagline", t: 0.988, side: 1.55, y: -0.2 }, { type: "flagline", t: 0.988, side: -1.55, y: -0.2 },
    ],
    billboards: [
      { t: 0.09, side: -1.7, lines: ["TEN THOUSAND BTC", "= 2 PIZZAS"], fg: "#F7931A" },
      { t: 0.25, side: 1.7, lines: ["STAY HUMBLE", "STACK SATS"], fg: "#F7931A", fontSize: 48 },
      { t: 0.42, side: -1.8, lines: ["PIZZA BEACH", "NO REFUNDS"], fg: "#F6C453" },
      { t: 0.6, side: -1.7, lines: ["ORANGE PILL ZONE"], fg: "#FB923C", fontSize: 50 },
      { t: 0.73, side: 1.8, lines: ["STACK SATS", "EAT PIZZA"], fg: "#4ADE80" },
      { t: 0.9, side: 1.6, lines: ["WAGMI"], fg: "#4ADE80" },
    ],
    sky: "day",
  },
  {
    id: "genesis-circuit",
    name: "Genesis Circuit",
    world: "genesis",
    music: "genesis",
    laps: 4,
    width: 14,
    ridge: 24,
    theme: "circuit",
    hillAmp: 1.4, // set-piece pass 2026-07-18: rolling countryside · was the
    // only Genesis track with dead-flat terrain
    intro: "Where the chain began. One clean line around the arch of Block Zero.",
    tip: "The Timestamp Ramp wants full throttle. The Block Zero tunnel wants nerve.",
    // genesis rework 2026-07-18: loop scaled x1.2 for high-speed room ·
    // the old final elbow sat ON the start line (grid parked mid-corner,
    // inner wall jutting at the flag); pts 13..15 now corner BEFORE a
    // real start/finish straight.
    pts: [
      [0, 0.5, 0], [0, 0.5, 108], [-17, 0.8, 175], [-77, 1.5, 202], [-142, 4.5, 180],
      [-166, 5.5, 120], [-139, 3.5, 62], [-170, 2.0, 0], [-142, 1.5, -60],
      [-77, 1.0, -84], [-29, 1.2, -130], [26, 1.6, -154], [79, 2.4, -130],
      [103, 0.8, -77], [53, 0.6, -77], [5, 0.5, -48],
    ],
    // stadium Timestamp Ramp · 0.05 pad sits BEFORE the rise (a pad on
    // the carve sank into the ramp). Keep jumps clear of tunnel windows.
    boost: [{ t: 0.05, side: 0 }, { t: 0.52, side: 0 }],
    jumps: [{ t: 0.095, h: 6.5 }],
    tunnels: [{ t0: 0.54, t1: 0.64 }],
    boxes: [0.16, 0.44, 0.72, 0.95],
    sats: [
      { t0: 0.1, t1: 0.16, side: -0.5 }, { t0: 0.32, t1: 0.4, side: 0.5 },
      { t0: 0.55, t1: 0.62, side: 0 }, { t0: 0.8, t1: 0.87, side: -0.5 },
    ],
    props: [
      // THE TIMECHAIN · a lit ledger arcing across the whole sky
      { type: "timechainArc", t: 0.5, side: 0, scale: 1.4, y: 26, rot: 0 },
      { type: "genesisArch", t: 0.3, side: 6, scale: 6, y: -1 },
      // map pass 2026-07-16: horizon monuments
      { type: "genesisArch", t: 0.5, side: -4.6, scale: 2.0 }, { type: "terminal", t: 0.66, side: 4.4, scale: 1.8 },
      { type: "rock", t: 0.85, side: -4.8, scale: 2.2 },
      { type: "genesisArch", t: 0.02, side: 0, scale: 1.3 },
      { type: "terminal", t: 0.2, side: 1.9 }, { type: "terminal", t: 0.28, side: -2.0 },
      { type: "terminal", t: 0.48, side: 2.1 }, { type: "terminal", t: 0.52, side: -1.8 }, // before the tunnel mouth
      { type: "terminal", t: 0.84, side: 1.8 },
      { type: "terminal", t: 0.36, side: -1.9 }, { type: "terminal", t: 0.72, side: 2.0 },
      { type: "terminal", t: 0.94, side: -1.9 },
      { type: "rock", t: 0.38, side: 2.4 }, { type: "rock", t: 0.68, side: -2.5 },
      { type: "rock", t: 0.52, side: -2.4 },
      { type: "balloon", t: 0.25, side: 1.5 }, { type: "balloon", t: 0.67, side: -1.5 }, // past the tunnel exit
      { type: "streetLamp", t: 0.12, side: 1.5 }, { type: "streetLamp", t: 0.4, side: -1.5 },
      { type: "streetLamp", t: 0.76, side: 1.5 }, { type: "streetLamp", t: 0.67, side: 1.5 }, // past the tunnel exit
      // K14 · crowd tuple mirrors its grandstand exactly (see pizza-beach)
      { type: "grandstand", t: 0.982, side: 2, y: -0.2 }, { type: "crowdA", t: 0.982, side: 2, y: -0.2 },
      { type: "grandstand", t: 0.994, side: -2, y: -0.2 }, { type: "crowdA", t: 0.994, side: -2, y: -0.2 },
      { type: "grandstand", t: 0.072, side: -2, y: -0.8, rot: 0.34 }, { type: "crowdA", t: 0.072, side: -2, y: -0.8, rot: 0.34 },
      { type: "flagline", t: 0.988, side: 1.55, y: -0.2 }, { type: "flagline", t: 0.988, side: -1.55, y: -0.2 },
    ],
    billboards: [
      { t: 0.06, side: 1.7, lines: ["RUN YOUR NODE"], fg: "#33FF66" },
      { t: 0.2, side: -1.7, lines: ["FIX THE MONEY", "FIX THE WORLD"], fg: "#F7931A", fontSize: 44 },
      { t: 0.36, side: -1.8, lines: ["CHANCELLOR ON BRINK", "OF SECOND BAILOUT"], fg: "#F5F5F7", fontSize: 40 },
      { t: 0.5, side: 1.7, lines: ["DONT TRUST", "VERIFY"], fg: "#33FF66", fontSize: 50 },
      { t: 0.66, side: 1.8, lines: ["VIRES IN NUMERIS"], fg: "#F7931A" },
      { t: 0.88, side: -1.7, lines: ["21 MILLION", "NO EXCEPTIONS"], fg: "#F5F5F7", fontSize: 46 },
    ],
    sky: "day",
  },
  {
    id: "gox-docks",
    name: "Gox Docks",
    world: "genesis",
    music: "genesis",
    laps: 4,
    width: 13,
    ridge: 16,
    theme: "docks",
    hillAmp: 1.35, // map pass 2026-07-16 · terrain drama, road apron untouched
    island: 152, // set-piece pass 2026-07-18: harbor water pulled in from the
    // theme default 190 · the outer piers now sit a boat-length from the
    // waterline, so both open hazard edges drop into visible harbor
    intro: "Rain on the exchange. Watch the slick piers, keep your keys.",
    tip: "Shortcut: the Cold Storage Lane between containers. Slippery when wet, always wet.",
    gripMult: 0.85,
    pts: [
      [0, 0.5, 0], [-2, 0.5, 70], [10, 0.5, 122], [64, 2.2, 138], [112, 0.5, 118],
      [128, 0.5, 66], [104, 0.5, 22], [130, 0.5, -28], [112, 0.6, -78],
      [62, 2.6, -98], [8, 0.6, -84], [-40, 0.5, -100], [-84, 1.4, -70],
      [-84, 0.5, -14], [-48, 0.5, 8], [-16, 0.5, -12],
    ],
    hazards: [{ t0: 0.32, t1: 0.42, side: "out" }, { t0: 0.76, t1: 0.88, side: "out" }],
    // epic-air 2026-07-18: pier CATAPULT (h 5.5 x1.25 off the 0.26 pad)
    // flies INSIDE the open-water window by design, landing past it
    // (~0.43 race pace) · tunnel roofs the Cold Storage Lane · warehouse
    // rollers pts 3/9/12.
    boost: [{ t: 0.26, side: 0 }, { t: 0.74, side: 0 }],
    jumps: [{ t: 0.32, h: 5.5, boost: 1.25 }],
    tunnels: [{ t0: 0.57, t1: 0.65 }],
    boxes: [0.14, 0.4, 0.63, 0.88],
    sats: [
      { t0: 0.07, t1: 0.13, side: 0.45 }, { t0: 0.3, t1: 0.37, side: -0.5 },
      { t0: 0.52, t1: 0.58, side: 0.5 }, { t0: 0.78, t1: 0.85, side: 0 },
    ],
    props: [
      // the wreck itself · going down stern-first where the fins circle
      { type: "wreckShip", t: 0.37, side: 6, scale: 2.2, y: -1.5, rot: 2.2 },
      { type: "crane", t: 0.6, side: 6, scale: 6.5, y: -2 },
      { type: "bearFin", t: 0.355, side: 6, scale: 2.3, y: -1.5 },
      { type: "bearFin", t: 0.38, side: 6, scale: 2.7, y: -1.5 },
      // bear harbor: fins cut the one wet reach off the pier hazard edge
      // (water-level placements probed headless · terrain is dry elsewhere)
      { type: "bearFin", t: 0.34, side: 6, scale: 2.6, y: -1.5 },
      { type: "bearFin", t: 0.365, side: 6, scale: 2.0, y: -1.5 },
      { type: "bearFin", t: 0.395, side: 6, scale: 3.0, y: -1.5 },
      // map pass 2026-07-16: harbor spill falls + crane skyline
      // (falls scaled up 2026-07-18 · a hero landmark, not a garden feature)
      { type: "waterfall", t: 0.48, side: 3.4, scale: 1.6 },
      { type: "crane", t: 0.62, side: 4.8, scale: 1.7 }, { type: "crane", t: 0.08, side: -4.5, scale: 1.5 },
      { type: "container", t: 0.75, side: 4.2, scale: 1.8 }, { type: "container", t: 0.78, side: 4.6, scale: 1.6 },
      { type: "container", t: 0.1, side: 2.0 }, { type: "container", t: 0.17, side: -2.1 },
      { type: "container", t: 0.34, side: 2.2 }, { type: "container", t: 0.45, side: -1.9 },
      { type: "container", t: 0.54, side: 2.0 }, { type: "container", t: 0.72, side: -2.2 }, // 0.54: before the tunnel mouth
      { type: "container", t: 0.8, side: 2.1 }, { type: "container", t: 0.92, side: -2.0 },
      { type: "crane", t: 0.28, side: 3.2, scale: 1.2 }, { type: "crane", t: 0.66, side: -3.4, scale: 1.1 },
      { type: "crane", t: 0.5, side: 3.3, scale: 1.15 },
      { type: "container", t: 0.24, side: -2.0 }, { type: "container", t: 0.68, side: -2.1 }, // 0.68: past the tunnel exit
      { type: "buoy", t: 0.5, side: 3.4 }, { type: "buoy", t: 0.96, side: -3.2 },
      { type: "buoy", t: 0.3, side: -3.5 },
      { type: "streetLamp", t: 0.05, side: -1.4 }, { type: "streetLamp", t: 0.42, side: 1.4 },
      { type: "streetLamp", t: 0.85, side: -1.4 },
      { type: "balloon", t: 0.48, side: 1.4 }, { type: "balloon", t: 0.9, side: -1.4 },
      // K14 · crowd tuple mirrors its grandstand exactly (see pizza-beach)
      { type: "grandstand", t: 0.982, side: 2, y: -0.2 }, { type: "crowdA", t: 0.982, side: 2, y: -0.2 },
      { type: "grandstand", t: 0.994, side: -2, y: -0.2 }, { type: "crowdA", t: 0.994, side: -2, y: -0.2 },
      { type: "grandstand", t: 0.3, side: 2, y: -1.2, rot: 2.43 }, { type: "crowdA", t: 0.3, side: 2, y: -1.2, rot: 2.43 },
      { type: "flagline", t: 0.988, side: 1.55, y: -0.2 }, { type: "flagline", t: 0.988, side: -1.55, y: -0.2 },
    ],
    billboards: [
      { t: 0.29, side: -1.7, lines: ["SOMETHING", "IN THE WATER"], fg: "#7DE3FF", fontSize: 44 },
      { t: 0.08, side: 1.7, lines: ["COLD STORAGE", "OR NO STORAGE"], fg: "#22D3EE", fontSize: 44 },
      { t: 0.2, side: -1.7, lines: ["WITHDRAWALS", "TEMPORARILY PAUSED"], fg: "#E5484D", fontSize: 44 },
      { t: 0.48, side: 1.6, lines: ["IN MEMORIAM:", "YOUR ALTCOINS"], fg: "#9999A1", fontSize: 44 },
      { t: 0.55, side: 1.7, lines: ["NOT YOUR KEYS", "NOT YOUR COINS"], fg: "#F7931A", fontSize: 46 },
      { t: 0.68, side: -1.6, lines: ["HAVE FUN", "STAYING SOLVENT"], fg: "#E5484D", fontSize: 44 },
      { t: 0.83, side: -1.7, lines: ["GOX DOCKS", "TRUST, BUT VERIFY"], fg: "#9999A1", fontSize: 44 },
    ],
    sky: "rain",
  },
  {
    id: "winter-2014",
    name: "Winter of 2014",
    world: "genesis",
    music: "winter",
    laps: 4,
    width: 14,
    ridge: 40,
    fogFar: 340,
    theme: "winter",
    hillAmp: 2.1, // map pass 2026-07-16 · terrain drama, road apron untouched
    boss: "bear2014",
    intro: "The long winter that forged the faithful. Race the Bear itself.",
    tip: "Ice does not forgive a late drift. Neither does the Bear.",
    gripMult: 0.78,
    pts: [
      [0, 1, 0], [-6, 2, 66], [8, 4, 124], [58, 7, 156], [116, 10, 148],
      [150, 13, 100], [146, 15, 40], [172, 18, -12], [150, 12, -66],
      [96, 11, -96], [40, 9, -84], [-4, 7, -110], [-52, 5, -92],
      [-68, 3, -42], [-40, 1.6, -8],
    ],
    // epic-air 2026-07-18: the SKI-JUMP MONSTER (summit 18, h 8.5 x1.3,
    // 0.45 pad feed, box row on the rise) · worst-case stacked flights
    // land ~0.77 per the review sims, so the cliff window opens at 0.8
    // and the whole landing valley is walled. Ridge window 0.2..0.29
    // keeps the climb dangerous.
    hazards: [{ t0: 0.2, t1: 0.29, side: "out" }, { t0: 0.8, t1: 0.87, side: "out" }, { t0: 0.52, t1: 0.545, side: "out" }, { t0: 0.52, t1: 0.545, side: "in" }],
    boost: [{ t: 0.45, side: 0 }, { t: 0.93, side: 0 }],
    jumps: [{ t: 0.52, h: 8.5, boost: 1.3 }],
    // THE CREVASSE OF 2014 (epic-scale pass 2026-07-21): the land either
    // side of the signature jump plunges into a frost-lit gorge · the road
    // is a causeway, the walls are gone, and winter is a long way down
    chasms: [{ t0: 0.42, t1: 0.555, w: 44, depth: 30, glow: "#7DE3FF" }],
    boxes: [0.18, 0.5, 0.8],
    sats: [
      { t0: 0.1, t1: 0.17, side: 0.5 }, { t0: 0.36, t1: 0.44, side: -0.5 },
      { t0: 0.62, t1: 0.7, side: 0.4 }, { t0: 0.85, t1: 0.9, side: -0.4 },
    ],
    props: [
      // frost falls pour off the rim into the crevasse
      { type: "waterfall", t: 0.44, side: 2.2, scale: 3.2, y: -3 },
      { type: "waterfall", t: 0.56, side: -2.4, scale: 3.5, y: -3 },
      // crevasse dressing: frost fangs on the gorge floor + the frozen
      // colossus watching the flight from the horizon
      { type: "iceSpike", t: 0.49, side: 2.8, scale: 3.8, y: -23.6 },
      { type: "iceSpike", t: 0.47, side: -3.0, scale: 3.4, y: -23.6 },
      { type: "fudStatue", t: 0.5, side: -6, scale: 7.5, y: -8.5, watch: true },
      // map pass 2026-07-16: frozen falls + far treeline depth (first falls
      // scaled to landmark size 2026-07-18 · it crowns the new ridge window)
      { type: "waterfall", t: 0.3, side: -3.6, scale: 2.3 }, { type: "waterfall", t: 0.74, side: 3.2, scale: 1.3 },
      { type: "snowPine", t: 0.4, side: 4.4, scale: 1.9 }, { type: "snowPine", t: 0.44, side: 4.9, scale: 1.5 },
      { type: "snowPine", t: 0.86, side: -4.6, scale: 2.1 }, { type: "iceSpike", t: 0.55, side: -4.2, scale: 2.4 },
      { type: "snowPine", t: 0.05, side: 1.9 }, { type: "snowPine", t: 0.12, side: -2.0 },
      { type: "snowPine", t: 0.22, side: 2.3 }, { type: "snowPine", t: 0.3, side: -1.8 },
      { type: "snowPine", t: 0.55, side: 2.0 }, { type: "snowPine", t: 0.63, side: -2.2 },
      { type: "snowPine", t: 0.75, side: 1.9 }, { type: "snowPine", t: 0.88, side: -2.0 },
      { type: "iceSpike", t: 0.35, side: 2.6 }, { type: "iceSpike", t: 0.47, side: -2.5 },
      { type: "iceSpike", t: 0.7, side: 2.8 }, { type: "iceSpike", t: 0.92, side: -2.6 },
      { type: "snowPine", t: 0.42, side: 1.8 }, { type: "snowPine", t: 0.68, side: -1.9 },
      { type: "snowPine", t: 0.95, side: 2.1 },
      { type: "fudStatue", t: 0.27, side: -1.6 }, { type: "fudStatue", t: 0.58, side: 1.6 },
      { type: "fudStatue", t: 0.82, side: -1.7 },
      { type: "balloon", t: 0.4, side: 1.4 }, { type: "balloon", t: 0.78, side: -1.4 },
      // K14 · crowd tuple mirrors its grandstand exactly (see pizza-beach)
      { type: "grandstand", t: 0.982, side: 2, y: -0.2 }, { type: "crowdA", t: 0.982, side: 2, y: -0.2 },
      { type: "grandstand", t: 0.994, side: -2, y: -0.2 }, { type: "crowdA", t: 0.994, side: -2, y: -0.2 },
      { type: "grandstand", t: 0.405, side: -2, y: -0.1, rot: -3.12 }, { type: "crowdA", t: 0.405, side: -2, y: -0.1, rot: -3.12 },
      { type: "flagline", t: 0.988, side: 1.55, y: -0.2 }, { type: "flagline", t: 0.988, side: -1.55, y: -0.2 },
    ],
    billboards: [
      { t: 0.415, side: 1.7, lines: ["DON'T LOOK", "DOWN"], fg: "#7DE3FF", fontSize: 48 },
      { t: 0.08, side: -1.7, lines: ["SELL NOW", "ASK ME HOW"], fg: "#9CD6E8", fontSize: 48 },
      { t: 0.24, side: 1.7, lines: ["IT IS GOING", "TO ZERO"], fg: "#9CD6E8", fontSize: 52 },
      { t: 0.4, side: 1.6, lines: ["FIRST THEY", "IGNORE YOU"], fg: "#BEE7F2", fontSize: 46 },
      { t: 0.56, side: -1.7, lines: ["WINTER OF 2014", "DRESS WARM"], fg: "#BEE7F2", fontSize: 44 },
      { t: 0.76, side: -1.6, lines: ["STILL EARLY", "STILL COLD"], fg: "#F7931A", fontSize: 46 },
      { t: 0.9, side: 1.7, lines: ["HODL"], fg: "#F7931A" },
    ],
    sky: "snow",
  },
  {
    id: "blocksize-fog",
    name: "Blocksize Fog",
    world: "neon",
    music: "neon",
    laps: 3,
    width: 16,
    theme: "fog",
    intro: "A civil war of megabytes and minds. Pick a side of the road.",
    tip: "The fork ahead is a lie. Both lanes rejoin. The argument never does.",
    fogNear: 30,
    fogFar: 150,
    hillAmp: 1.3, // epic-air pass 2026-07-18: rolling fog-silhouette hills
    pts: [
      [0, 0.6, 0], [2, 0.8, 76], [-10, 1.2, 138], [-58, 2, 170], [-116, 2.6, 156],
      [-148, 2, 104], [-134, 1.4, 46], [-158, 1.2, -12], [-134, 1.4, -70],
      [-80, 2, -100], [-22, 2.6, -86], [26, 3.4, -114], [70, 2.6, -90],
      [84, 1, -36], [52, 0.7, -4],
    ],
    divider: { t0: 0.28, t1: 0.44 },
    boost: [{ t: 0.22, side: -0.4 }, { t: 0.22, side: 0.4 }, { t: 0.68, side: 0 }],
    // signature air: FOG LEAP · crest launch straight into the fog wall
    jumps: [{ t: 0.8, h: 5.5 }],
    tunnels: [{ t0: 0.56, t1: 0.65 }],
    boxes: [0.12, 0.4, 0.64, 0.9],
    sats: [
      { t0: 0.3, t1: 0.42, side: -0.55 }, { t0: 0.3, t1: 0.42, side: 0.55 },
      { t0: 0.58, t1: 0.65, side: 0 }, { t0: 0.82, t1: 0.9, side: 0.5 },
    ],
    props: [
      // ghost giants in the fog · the civil war never left
      { type: "fudStatue", t: 0.3, side: 5, scale: 5, y: -2, watch: true },
      { type: "fudStatue", t: 0.7, side: -5, scale: 5, y: -2, watch: true },
      // map pass 2026-07-16: fog-silhouette skyline
      { type: "cityTower", t: 0.2, side: 5.2, scale: 2.4 }, { type: "cityTower", t: 0.5, side: -5.4, scale: 2.8 },
      { type: "cityTower", t: 0.78, side: 5.0, scale: 2.2 },
      { type: "cityTower", t: 0.06, side: 2.4 }, { type: "cityTower", t: 0.14, side: -2.6 },
      { type: "cityTower", t: 0.36, side: 2.8 }, { type: "cityTower", t: 0.5, side: -2.4 },
      { type: "cityTower", t: 0.6, side: 2.5 }, { type: "cityTower", t: 0.74, side: -2.7 },
      { type: "cityTower", t: 0.86, side: 2.6 }, { type: "cityTower", t: 0.94, side: -2.5 },
      { type: "streetLamp", t: 0.1, side: 1.5 }, { type: "streetLamp", t: 0.31, side: -1.5 },
      { type: "streetLamp", t: 0.55, side: 1.5 }, { type: "streetLamp", t: 0.79, side: -1.5 },
      { type: "terminal", t: 0.2, side: 1.8 }, { type: "terminal", t: 0.44, side: -1.8 },
      { type: "neonArch", t: 0.24, side: -1.9 }, { type: "neonArch", t: 0.8, side: 1.9 },
      { type: "balloon", t: 0.35, side: 0 }, { type: "balloon", t: 0.72, side: 1.4 },
      // K14 · crowd tuple mirrors its grandstand exactly (see pizza-beach)
      { type: "grandstand", t: 0.982, side: 2, y: -0.2 }, { type: "crowdA", t: 0.982, side: 2, y: -0.2 },
      { type: "grandstand", t: 0.994, side: -2, y: -0.2 }, { type: "crowdA", t: 0.994, side: -2, y: -0.2 },
      { type: "grandstand", t: 0.775, side: 2, y: -0.7, rot: 0.18 }, { type: "crowdA", t: 0.775, side: 2, y: -0.7, rot: 0.18 },
      { type: "flagline", t: 0.988, side: 1.55, y: -0.2 }, { type: "flagline", t: 0.988, side: -1.55, y: -0.2 },
    ],
    billboards: [
      { t: 0.1, side: 1.7, lines: ["NGMI"], fg: "#E5484D" },
      { t: 0.24, side: -1.6, lines: ["<- BIG BLOCK"], fg: "#22D3EE", fontSize: 56 },
      { t: 0.24, side: 1.6, lines: ["SMALL BLOCK ->"], fg: "#F7931A", fontSize: 56 },
      { t: 0.48, side: -1.7, lines: ["FORK AHEAD", "BOTH ROADS RHYME"], fg: "#9999A1", fontSize: 44 },
      { t: 0.76, side: 1.7, lines: ["CONSENSUS", "EVENTUALLY"], fg: "#4ADE80", fontSize: 50 },
      { t: 0.9, side: -1.6, lines: ["RUN THE NUMBERS", "RUN A NODE"], fg: "#22D3EE", fontSize: 44 },
    ],
    sky: "fog",
  },
  {
    id: "euphoria-neon",
    name: "Euphoria Neon",
    world: "neon",
    music: "neon",
    laps: 3,
    width: 14,
    ridge: 30,
    fogFar: 340,
    theme: "neoncity",
    intro: "Candle skyscrapers and FOMO in the air. Send it.",
    tip: "Shortcut: the Leverage Overpass. Great view, long fall in confidence.",
    pts: [
      [0, 0.6, 0], [4, 0.8, 80], [-6, 2.5, 150], [-52, 5, 186], [-110, 7, 168],
      [-136, 3, 112], [-118, 2, 56], [-146, 1.5, -2], [-120, 3, -60],
      [-64, 6, -86], [-10, 7.5, -70], [30, 6, -104], [76, 3.5, -86],
      [90, 1.4, -32], [56, 0.7, -2],
    ],
    // signature air: the LEVERAGE OVERPASS · h 6.8 lip rides the pt 3..4
    // CLIMB (a lip on a descending base reads as a hop)
    boost: [{ t: 0.18, side: 0 }, { t: 0.235, side: 0 }, { t: 0.57, side: 0.3 }, { t: 0.84, side: 0 }],
    jumps: [{ t: 0.28, h: 6.8, boost: 1.25 }],
    // THE LIQUIDATION GAP: the leverage district ends in a red-lit chasm ·
    // margin call sharks circle the glow at the bottom
    chasms: [{ t0: 0.215, t1: 0.36, w: 40, depth: 26, glow: "#E5484D" }],
    gaps: [{ t0: 0.283, t1: 0.316 }],
    hazards: [{ t0: 0.28, t1: 0.35, side: "out" }, { t0: 0.28, t1: 0.35, side: "in" }],
    boxes: [0.1, 0.36, 0.6, 0.86],
    sats: [
      { t0: 0.14, t1: 0.2, side: 0.5 }, { t0: 0.4, t1: 0.47, side: -0.5 },
      { t0: 0.63, t1: 0.7, side: 0.5 }, { t0: 0.88, t1: 0.94, side: -0.45 },
    ],
    props: [
      { type: "holoB", t: 0.5, side: 4, scale: 3.5, y: 32 },
      { type: "candleTower", t: 0.6, side: 6, scale: 6, y: -2 },
      { type: "bearFin", t: 0.289, side: 0.5, scale: 2.6, y: -20.5 },
      { type: "bearFin", t: 0.296, side: -0.8, scale: 2.2, y: -20.5 },
      { type: "bearFin", t: 0.245, side: 2.7, scale: 2.4, y: -20.5 },
      { type: "bearFin", t: 0.3, side: -2.9, scale: 2.8, y: -20.5 },
      { type: "bearFin", t: 0.33, side: 3.1, scale: 2.0, y: -20.5 },
      // map pass 2026-07-16: neon skyline depth
      { type: "candleTower", t: 0.36, side: 5.2, scale: 2.6 }, { type: "candleTower", t: 0.68, side: -5.3, scale: 2.3 },
      { type: "streetLamp", t: 0.9, side: 2.2 }, { type: "streetLamp", t: 0.92, side: -2.2 },
      { type: "candleTower", t: 0.05, side: 2.2 }, { type: "candleTower", t: 0.13, side: -2.4 },
      { type: "candleTower", t: 0.21, side: 2.6 }, { type: "candleTower", t: 0.32, side: -2.2 },
      { type: "candleTower", t: 0.4, side: 2.4 }, { type: "candleTower", t: 0.5, side: -2.6 },
      { type: "candleTower", t: 0.58, side: 2.3 }, { type: "candleTower", t: 0.67, side: -2.3 },
      { type: "candleTower", t: 0.76, side: 2.5 }, { type: "candleTower", t: 0.86, side: -2.4 },
      { type: "candleTower", t: 0.93, side: 2.2 },
      { type: "neonArch", t: 0.16, side: 1.8 }, { type: "neonArch", t: 0.47, side: -1.8 },
      { type: "neonArch", t: 0.72, side: 1.8 },
      { type: "streetLamp", t: 0.28, side: 1.5 }, { type: "streetLamp", t: 0.54, side: -1.5 },
      { type: "streetLamp", t: 0.82, side: -1.5 },
      { type: "balloon", t: 0.3, side: -1.4 }, { type: "balloon", t: 0.66, side: 1.4 },
      // K14 · crowd tuple mirrors its grandstand exactly (see pizza-beach)
      { type: "grandstand", t: 0.982, side: 2, y: -0.2 }, { type: "crowdA", t: 0.982, side: 2, y: -0.2 },
      { type: "grandstand", t: 0.994, side: -2, y: -0.2 }, { type: "crowdA", t: 0.994, side: -2, y: -0.2 },
      { type: "grandstand", t: 0.18, side: -2, y: -0.4, rot: -1.67 }, { type: "crowdA", t: 0.18, side: -2, y: -0.4, rot: -1.67 },
      { type: "flagline", t: 0.988, side: 1.55, y: -0.2 }, { type: "flagline", t: 0.988, side: -1.55, y: -0.2 },
    ],
    billboards: [
      { t: 0.2, side: -1.7, lines: ["MARGIN CALL", "BELOW"], fg: "#E5484D", fontSize: 48 },
      { t: 0.08, side: -1.7, lines: ["NUMBER GO UP"], fg: "#4ADE80" },
      { t: 0.19, side: 1.7, lines: ["WE CALL THEM", "POOR"], fg: "#F5F5F7", fontSize: 48 },
      { t: 0.37, side: 1.7, lines: ["FOMO", "AT FULL THROTTLE"], fg: "#E5484D", fontSize: 48 },
      { t: 0.5, side: -1.7, lines: ["LEVERAGE:", "A HELL OF A DRUG"], fg: "#E5484D", fontSize: 42 },
      { t: 0.62, side: -1.7, lines: ["NEW PARADIGM", "SAME GRAVITY"], fg: "#22D3EE", fontSize: 46 },
      { t: 0.9, side: 1.7, lines: ["EUPHORIA NEON"], fg: "#F7931A", fontSize: 52 },
    ],
    sky: "night",
  },
  {
    id: "printer-runway",
    name: "Printer Runway",
    world: "neon",
    music: "printer",
    laps: 3,
    width: 15,
    ridge: 32,
    fogFar: 340,
    theme: "printer",
    intro: "The printers never sleep. Outrun the confetti before it buries the road.",
    tip: "The confetti is free. So is the slowdown when you drive through it.",
    hillAmp: 1.7,
    pts: [
      [0, 0.5, 0], [0, 0.5, 110], [-8, 0.8, 180], [-60, 1.4, 208], [-118, 1.2, 186],
      [-140, 0.8, 128], [-124, 0.6, 70], [-124, 1.8, -20], [-140, 0.8, -86],
      [-104, 0.8, -134], [-44, 1.4, -142], [10, 1, -118], [44, 0.7, -70],
      [40, 0.5, -18],
    ],
    // signature air: the RUNWAY LAUNCH (h 7.2 x1.28, 0.5 pad feed)
    boost: [{ t: 0.03, side: 0 }, { t: 0.4, side: 0 }, { t: 0.5, side: 0 }, { t: 0.75, side: 0 }],
    jumps: [{ t: 0.55, h: 7.2, boost: 1.28 }],
    // THE SHREDDER TRENCH: the runway crosses a burning cash trench ·
    // what the printer prints, the trench takes back
    chasms: [{ t0: 0.48, t1: 0.64, w: 42, depth: 30, glow: "#FB923C" }],
    hazards: [{ t0: 0.55, t1: 0.63, side: "out" }, { t0: 0.55, t1: 0.63, side: "in" }],
    boxes: [0.15, 0.46, 0.7, 0.93],
    sats: [
      { t0: 0.05, t1: 0.14, side: 0.5 }, { t0: 0.33, t1: 0.44, side: -0.5 },
      { t0: 0.56, t1: 0.63, side: 0.45 }, { t0: 0.8, t1: 0.88, side: -0.45 },
    ],
    props: [
      { type: "printer", t: 0.3, side: 6, scale: 7, y: -1, emit: "paper" },
      // map pass 2026-07-16: the mega-printer + industrial horizon
      { type: "printer", t: 0.5, side: 4.6, scale: 2.6 }, { type: "cityTower", t: 0.7, side: -5.2, scale: 2.4 },
      { type: "cityTower", t: 0.16, side: -5.0, scale: 2.0 },
      { type: "printer", t: 0.09, side: 2.2, scale: 1.3 }, { type: "printer", t: 0.27, side: -2.3, scale: 1.5 },
      { type: "printer", t: 0.49, side: 2.4, scale: 1.2 }, { type: "printer", t: 0.71, side: -2.2, scale: 1.6 },
      { type: "printer", t: 0.9, side: 2.3, scale: 1.3 },
      { type: "cityTower", t: 0.18, side: -3.0 }, { type: "cityTower", t: 0.6, side: 3.2 },
      { type: "cityTower", t: 0.33, side: 2.9 }, { type: "cityTower", t: 0.79, side: -3.0 },
      { type: "kiosk", t: 0.56, side: -1.7 },
      { type: "streetLamp", t: 0.12, side: -1.5 }, { type: "streetLamp", t: 0.36, side: 1.5 },
      { type: "streetLamp", t: 0.64, side: -1.5 }, { type: "streetLamp", t: 0.84, side: 1.5 },
      { type: "streetLamp", t: 0.96, side: -1.5 },
      { type: "balloon", t: 0.44, side: 1.4 }, { type: "balloon", t: 0.86, side: -1.4 },
      // K14 · crowd tuple mirrors its grandstand exactly (see pizza-beach)
      { type: "grandstand", t: 0.982, side: 2, y: -0.2 }, { type: "crowdA", t: 0.982, side: 2, y: -0.2 },
      { type: "grandstand", t: 0.994, side: -2, y: -0.2 }, { type: "crowdA", t: 0.994, side: -2, y: -0.2 },
      { type: "grandstand", t: 0.465, side: 2, y: -0.1, rot: -3.13 }, { type: "crowdA", t: 0.465, side: 2, y: -0.1, rot: -3.13 },
      { type: "flagline", t: 0.988, side: 1.55, y: -0.2 }, { type: "flagline", t: 0.988, side: -1.55, y: -0.2 },
    ],
    billboards: [
      { t: 0.06, side: 1.7, lines: ["MONEY PRINTER", "GO BRRR"], fg: "#7FBF8E", fontSize: 50 },
      { t: 0.2, side: -1.7, lines: ["SAVINGS", "SOLD SEPARATELY"], fg: "#D8DBE2", fontSize: 44 },
      { t: 0.42, side: -1.7, lines: ["INFLATION IS", "TRANSITORY*"], fg: "#F5F5F7", fontSize: 48 },
      { t: 0.645, side: 1.6, lines: ["CANTILLON", "EXPRESS LANE"], fg: "#7FBF8E", fontSize: 44 },
      { t: 0.68, side: 1.7, lines: ["CASH IS TRASH", "DRIVE FASTER"], fg: "#E5484D", fontSize: 46 },
      { t: 0.95, side: -1.7, lines: ["PRINTER RUNWAY"], fg: "#F7931A", fontSize: 52 },
    ],
    sky: "dusk",
  },
  {
    id: "obituary-alley",
    name: "Obituary Alley",
    world: "neon",
    music: "boss",
    laps: 3,
    width: 14,
    ridge: 36,
    fogFar: 340,
    theme: "blimp",
    boss: "headline",
    intro: "The media declared this race over 473 times. Outdrive the Headline.",
    tip: "Flashbulbs pop on the inside lane. Blink second.",
    hillAmp: 1.2,
    pts: [
      [0, 0.6, 0], [-4, 1, 84], [14, 1.6, 148], [66, 2.4, 172], [122, 2, 144],
      [138, 2.6, 88], [118, 0.8, 34], [140, 1, -26], [118, 1.6, -82],
      [64, 2.4, -108], [6, 1.8, -92], [-42, 1.2, -112], [-82, 0.8, -80],
      [-84, 0.6, -26], [-48, 0.5, 2],
    ],
    // signature air: the HEADLINE LEAP (h 6 x1.15 off the 0.32 pad)
    boost: [{ t: 0.32, side: 0 }, { t: 0.85, side: 0 }],
    jumps: [{ t: 0.36, h: 6.0, boost: 1.15 }],
    boxes: [0.2, 0.52, 0.82],
    sats: [
      { t0: 0.08, t1: 0.15, side: -0.5 }, { t0: 0.36, t1: 0.44, side: 0.5 },
      { t0: 0.6, t1: 0.68, side: -0.45 }, { t0: 0.87, t1: 0.93, side: 0.4 },
    ],
    props: [
      { type: "newsVan", t: 0.6, side: 6, scale: 5.5, y: -2 },
      // map pass 2026-07-16: obituary skyline + a second blimp on the horizon
      { type: "cityTower", t: 0.5, side: 5.4, scale: 2.7 }, { type: "cityTower", t: 0.66, side: -5.2, scale: 2.3 },
      { type: "blimp", t: 0.4, side: -4.5, scale: 1.6 },
      { type: "cityTower", t: 0.04, side: 2.5 }, { type: "cityTower", t: 0.12, side: -2.6 },
      { type: "cityTower", t: 0.3, side: 2.7 }, { type: "cityTower", t: 0.44, side: -2.5 },
      { type: "cityTower", t: 0.56, side: 2.4 }, { type: "cityTower", t: 0.7, side: -2.6 },
      { type: "cityTower", t: 0.82, side: 2.5 }, { type: "cityTower", t: 0.92, side: -2.4 },
      { type: "newsVan", t: 0.18, side: 1.7 }, { type: "newsVan", t: 0.47, side: -1.7 },
      { type: "newsVan", t: 0.76, side: 1.6 },
      { type: "kiosk", t: 0.09, side: 1.7 }, { type: "kiosk", t: 0.35, side: -1.7 },
      { type: "kiosk", t: 0.66, side: -1.6 }, { type: "kiosk", t: 0.88, side: 1.7 },
      { type: "blimp", t: 0.25, side: -1.0, y: 26, scale: 1.6 },
      { type: "blimp", t: 0.62, side: 1.2, y: 30, scale: 1.9 },
      { type: "streetLamp", t: 0.09, side: -1.5 }, { type: "streetLamp", t: 0.5, side: 1.5 },
      { type: "balloon", t: 0.4, side: -1.4 }, { type: "balloon", t: 0.8, side: 1.4 },
      // K14 · crowd tuple mirrors its grandstand exactly (see pizza-beach)
      { type: "grandstand", t: 0.982, side: 2, y: -0.2 }, { type: "crowdA", t: 0.982, side: 2, y: -0.2 },
      { type: "grandstand", t: 0.994, side: -2, y: -0.2 }, { type: "crowdA", t: 0.994, side: -2, y: -0.2 },
      { type: "grandstand", t: 0.335, side: -2, y: -0.7, rot: -2.33 }, { type: "crowdA", t: 0.335, side: -2, y: -0.7, rot: -2.33 },
      { type: "flagline", t: 0.988, side: 1.55, y: -0.2 }, { type: "flagline", t: 0.988, side: -1.55, y: -0.2 },
    ],
    billboards: [
      { t: 0.14, side: -1.7, lines: ["BITCOIN DEAD", "No. 473"], fg: "#E5484D", fontSize: 52 },
      { t: 0.28, side: 1.7, lines: ["THIS TIME", "IT IS DIFFERENT"], fg: "#9999A1", fontSize: 46 },
      { t: 0.42, side: 1.7, lines: ["EXPERTS AGREE:", "IT IS OVER"], fg: "#D8DBE2", fontSize: 46 },
      { t: 0.58, side: 1.6, lines: ["ANALYST SEES", "ZERO BY FRIDAY"], fg: "#E5484D", fontSize: 42 },
      { t: 0.72, side: -1.7, lines: ["OBITUARY ALLEY", "STILL NOT DEAD"], fg: "#F7931A", fontSize: 44 },
      { t: 0.9, side: -1.6, lines: ["PRINT THE", "RETRACTION"], fg: "#F7931A", fontSize: 46 },
    ],
    sky: "night",
  },
  {
    id: "glass-tower-loop",
    name: "Glass Tower Loop",
    world: "corporate",
    music: "corporate",
    laps: 3,
    width: 14,
    ridge: 30,
    fogFar: 360,
    theme: "glass",
    intro: "Reflective canyons and elevator money. Prestige has a racing line.",
    tip: "Shortcut: the Buyback Elevator. It only goes up if you commit.",
    pts: [
      [0, 1, 0], [2, 2, 84], [-8, 4, 150], [-58, 7, 178], [-118, 9, 158],
      [-142, 7, 100], [-124, 4, 44], [-150, 3, -16], [-126, 5, -74],
      [-70, 8, -98], [-14, 10.5, -80], [30, 5, -110], [76, 4, -88],
      [90, 2, -32], [56, 1.2, -2],
    ],
    // signature air: the BUYBACK ELEVATOR (h 7 x1.2 rooftop lip · the
    // 0.575 pad sits BEFORE the rise; pads on the carve sink into it)
    boost: [{ t: 0.26, side: 0 }, { t: 0.575, side: -0.3 }, { t: 0.92, side: 0 }],
    jumps: [{ t: 0.62, h: 7.0, boost: 1.2 }],
    // THE MARGIN CANYON: the prestige district splits over an ice-lit
    // crack in the marble · leverage has a floor and this is not it
    chasms: [{ t0: 0.56, t1: 0.7, w: 40, depth: 28, glow: "#7DE3FF" }],
    hazards: [{ t0: 0.62, t1: 0.69, side: "out" }, { t0: 0.62, t1: 0.69, side: "in" }],
    boxes: [0.12, 0.38, 0.62, 0.88],
    sats: [
      { t0: 0.16, t1: 0.23, side: 0.5 }, { t0: 0.42, t1: 0.5, side: -0.5 },
      { t0: 0.66, t1: 0.73, side: 0.45 }, { t0: 0.9, t1: 0.96, side: -0.4 },
    ],
    props: [
      { type: "glassTower", t: 0.3, side: 6, scale: 5, y: -2 },
      // map pass 2026-07-16: corporate canyon depth
      { type: "glassTower", t: 0.4, side: 5.2, scale: 2.5 }, { type: "glassTower", t: 0.72, side: -5.4, scale: 2.9 },
      { type: "glassTower", t: 0.05, side: 2.3 }, { type: "glassTower", t: 0.15, side: -2.5 },
      { type: "glassTower", t: 0.24, side: 2.7 }, { type: "glassTower", t: 0.34, side: -2.3 },
      { type: "glassTower", t: 0.45, side: 2.4 }, { type: "glassTower", t: 0.54, side: -2.7 },
      { type: "glassTower", t: 0.64, side: 2.5 }, { type: "glassTower", t: 0.73, side: -2.4 },
      { type: "glassTower", t: 0.83, side: 2.6 }, { type: "glassTower", t: 0.93, side: -2.5 },
      { type: "cityTower", t: 0.1, side: -3.2 }, { type: "cityTower", t: 0.6, side: 3.4 },
      { type: "streetLamp", t: 0.2, side: 1.5 }, { type: "streetLamp", t: 0.48, side: -1.5 },
      { type: "streetLamp", t: 0.78, side: 1.5 }, { type: "streetLamp", t: 0.62, side: -1.5 },
      { type: "streetLamp", t: 0.9, side: 1.5 },
      { type: "balloon", t: 0.32, side: 1.4 }, { type: "balloon", t: 0.7, side: -1.4 },
      // K14 · crowd tuple mirrors its grandstand exactly (see pizza-beach)
      { type: "grandstand", t: 0.982, side: 2, y: -0.2 }, { type: "crowdA", t: 0.982, side: 2, y: -0.2 },
      { type: "grandstand", t: 0.994, side: -2, y: -0.2 }, { type: "crowdA", t: 0.994, side: -2, y: -0.2 },
      { type: "grandstand", t: 0.545, side: 2, y: -0.2, rot: 1.62 }, { type: "crowdA", t: 0.545, side: 2, y: -0.2, rot: 1.62 },
      { type: "flagline", t: 0.988, side: 1.55, y: -0.2 }, { type: "flagline", t: 0.988, side: -1.55, y: -0.2 },
    ],
    billboards: [
      { t: 0.1, side: -1.7, lines: ["TREASURY GRADE", "ASSETS ONLY"], fg: "#9FB6CE", fontSize: 46 },
      { t: 0.25, side: 1.7, lines: ["RAT POISON", "SQUARED"], fg: "#9FB6CE", fontSize: 46 },
      { t: 0.4, side: 1.7, lines: ["BALANCE SHEET", "ENERGY"], fg: "#F7931A", fontSize: 50 },
      { t: 0.55, side: -1.6, lines: ["PET ROCK", "PARKING ->"], fg: "#D8DBE2", fontSize: 46 },
      { t: 0.7, side: -1.7, lines: ["GLASS TOWER LOOP"], fg: "#7DE3FF", fontSize: 46 },
      { t: 0.85, side: 1.6, lines: ["SHAREHOLDER VALUE", "INTENSIFIES"], fg: "#7DE3FF", fontSize: 40 },
    ],
    sky: "dawn",
  },
  {
    id: "etf-dawn",
    name: "ETF Dawn Speedway",
    world: "corporate",
    music: "corporate",
    laps: 3,
    width: 18,
    ridge: 26,
    fogFar: 400,
    theme: "etf",
    intro: "Wall Street rings the bell at sunrise. You already had pole.",
    tip: "Full send through the bowl. Inflows only.",
    pts: [
      [0, 0.6, 0], [6, 0.6, 100], [0, 1.4, 190], [-50, 2.6, 246], [-130, 3, 260],
      [-206, 2.6, 232], [-244, 1.6, 160], [-236, 0.8, 80], [-196, 2.0, 20],
      [-196, 0.8, -60], [-236, 1.4, -120], [-216, 2.4, -196], [-140, 3, -230],
      [-60, 2.4, -212], [-10, 1.4, -150], [4, 0.7, -70],
    ],
    // signature air: the DAWN BOWL LAUNCH (h 7.5 x1.2, 0.45 pad feed)
    boost: [{ t: 0.1, side: 0 }, { t: 0.35, side: 0 }, { t: 0.45, side: 0 }, { t: 0.62, side: 0 }, { t: 0.87, side: 0 }],
    jumps: [{ t: 0.5, h: 7.5, boost: 1.2 }],
    // THE OPENING BELL DROP: the sunrise bowl cracks open mid-lap · gold
    // light pours out of the gap where the floor used to be
    chasms: [{ t0: 0.44, t1: 0.58, w: 44, depth: 28, glow: "#FFC24D" }],
    hazards: [{ t0: 0.5, t1: 0.57, side: "out" }, { t0: 0.5, t1: 0.57, side: "in" }],
    boxes: [0.18, 0.45, 0.72, 0.96],
    sats: [
      { t0: 0.05, t1: 0.15, side: 0.55 }, { t0: 0.28, t1: 0.4, side: -0.55 },
      { t0: 0.55, t1: 0.66, side: 0.5 }, { t0: 0.8, t1: 0.9, side: -0.5 },
    ],
    props: [
      { type: "openingBell", t: 0.41, side: -4, scale: 3, y: -0.5 },
      { type: "blimp", t: 0.3, side: 5, scale: 5, y: 26 },
      // map pass 2026-07-16: dawn skyline + one more parade cannon
      { type: "glassTower", t: 0.2, side: 5.3, scale: 2.4 }, { type: "cityTower", t: 0.48, side: -5.2, scale: 2.1 },
      { type: "confettiCannon", t: 0.9, side: 2.4 },
      { type: "etfFloat", t: 0.08, side: 2.2 }, { type: "etfFloat", t: 0.33, side: -2.4 },
      { type: "etfFloat", t: 0.58, side: 2.3 }, { type: "etfFloat", t: 0.82, side: -2.2 },
      { type: "glassTower", t: 0.2, side: 3.0 }, { type: "glassTower", t: 0.46, side: -3.2 },
      { type: "glassTower", t: 0.7, side: 3.1 }, { type: "glassTower", t: 0.94, side: -3.0 },
      { type: "glassTower", t: 0.14, side: -3.1 }, { type: "glassTower", t: 0.88, side: 3.0 },
      { type: "cityTower", t: 0.4, side: -3.3 },
      { type: "confettiCannon", t: 0.12, side: 1.6 }, { type: "confettiCannon", t: 0.63, side: -1.6 },
      { type: "confettiCannon", t: 0.4, side: 1.6 },
      { type: "streetLamp", t: 0.3, side: -1.5 },
      { type: "balloon", t: 0.26, side: 1.5 }, { type: "balloon", t: 0.52, side: -1.5 },
      { type: "balloon", t: 0.76, side: 1.5 }, { type: "balloon", t: 0.94, side: -1.5 },
      // K14 · crowd tuple mirrors its grandstand exactly (see pizza-beach)
      { type: "grandstand", t: 0.982, side: 2, y: -0.2 }, { type: "crowdA", t: 0.982, side: 2, y: -0.2 },
      { type: "grandstand", t: 0.994, side: -2, y: -0.2 }, { type: "crowdA", t: 0.994, side: -2, y: -0.2 },
      { type: "grandstand", t: 0.405, side: -2, y: -0.3, rot: 2.85 }, { type: "crowdA", t: 0.405, side: -2, y: -0.3, rot: 2.85 },
      { type: "flagline", t: 0.988, side: 1.55, y: -0.2 }, { type: "flagline", t: 0.988, side: -1.55, y: -0.2 },
    ],
    billboards: [
      { t: 0.05, side: -1.8, lines: ["ETF DAWN", "INFLOWS ONLY"], fg: "#F7931A", fontSize: 50 },
      { t: 0.25, side: 1.8, lines: ["BOOMER CAPITAL", "ONBOARDING"], fg: "#9FB6CE", fontSize: 44 },
      { t: 0.42, side: 1.8, lines: ["WALL STREET", "RINGS THE BELL"], fg: "#FFD166", fontSize: 46 },
      { t: 0.585, side: -1.8, lines: ["SUITS DISCOVER", "SELF CUSTODY"], fg: "#9FB6CE", fontSize: 42 },
      { t: 0.66, side: -1.8, lines: ["TICKER GOES", "ORANGE"], fg: "#4ADE80", fontSize: 50 },
      { t: 0.82, side: 1.8, lines: ["SIR, THE INFLOWS", "ARE ACCELERATING"], fg: "#4ADE80", fontSize: 40 },
    ],
    sky: "dawn",
  },
  {
    id: "one-chair-peak",
    name: "One Chair Peak",
    world: "corporate",
    music: "corporate",
    laps: 4,
    width: 13,
    ridge: 55,
    fogFar: 390,
    theme: "peak",
    hillAmp: 2.2, // map pass 2026-07-16 · terrain drama, road apron untouched
    intro: "The mountain finale. A throne vista under a laser-eye aurora.",
    tip: "The summit rewards patience. The descent rewards courage.",
    pts: [
      [0, 2, 0], [-8, 4, 70], [10, 7, 128], [58, 11, 150], [104, 15, 124],
      [118, 19, 66], [96, 22, 12], [118, 25, -44], [86, 27, -92],
      [28, 28, -104], [-24, 25, -84], [-70, 20, -104], [-104, 14, -72],
      [-100, 8, -16], [-56, 4, 4],
    ],
    boost: [{ t: 0.52, side: 0 }, { t: 0.72, side: 0 }, { t: 0.97, side: 0 }],
    // signature air: the RIDGE FLIGHT at 0.76 (h 6.5 x1.2 off the descent
    // shoulder) · the 0.42 crest hop stays as the warm-up
    jumps: [{ t: 0.42, h: 3.5 }, { t: 0.76, h: 6.5, boost: 1.2 }],
    // THE AURORA ABYSS (colossal pass 2026-07-21): the summit run ends
    // over a green-lit void · the deepest drop on the circuit
    chasms: [{ t0: 0.7, t1: 0.84, w: 46, depth: 34, glow: "#4ADE80" }],
    gaps: [{ t0: 0.763, t1: 0.804 }],
    hazards: [{ t0: 0.28, t1: 0.385, side: "out" }, { t0: 0.62, t1: 0.72, side: "out" }, { t0: 0.76, t1: 0.83, side: "out" }, { t0: 0.76, t1: 0.83, side: "in" }],
    boxes: [0.16, 0.48, 0.87],
    sats: [
      { t0: 0.1, t1: 0.18, side: -0.45 }, { t0: 0.34, t1: 0.42, side: 0.45 },
      { t0: 0.6, t1: 0.67, side: -0.4 }, { t0: 0.84, t1: 0.9, side: 0.4 },
    ],
    props: [
      { type: "auroraCurtain", t: 0.15, side: -5, scale: 2.5, y: 30 },
      { type: "auroraCurtain", t: 0.5, side: 5, scale: 3, y: 34 },
      // even the abyss has bears · fins circle the aurora glow
      { type: "bearFin", t: 0.771, side: 0.5, scale: 2.6, y: -26.9 },
      { type: "bearFin", t: 0.74, side: 2.8, scale: 2.4, y: -26.9 },
      { type: "bearFin", t: 0.79, side: -3.0, scale: 2.8, y: -26.9 },
      { type: "throne", t: 0.55, side: -6, scale: 7, y: -5.4, watch: true },
      // map pass 2026-07-16: mountain falls + monument rocks
      { type: "waterfall", t: 0.2, side: -3.8, scale: 2.0 }, { type: "waterfall", t: 0.62, side: 3.5, scale: 1.4 },
      { type: "rock", t: 0.35, side: 4.6, scale: 3.0 }, { type: "rockArch", t: 0.8, side: -4.4, scale: 1.8 },
      { type: "throne", t: 0.56, side: 2.4, scale: 1.6 },
      { type: "rock", t: 0.06, side: 2.0 }, { type: "rock", t: 0.14, side: -2.2 },
      { type: "rock", t: 0.26, side: 2.4 }, { type: "rock", t: 0.38, side: -2.0 },
      // 0.66 not 0.72: the Aurora Abyss carve (0.7-0.84) turns the rim
      // into a near-vertical face inside one terrain cell · no seat reads
      // right there (AAA r3 floating-boulder regression)
      { type: "rock", t: 0.62, side: -2.3 }, { type: "rock", t: 0.66, side: 2.1 },
      { type: "rock", t: 0.86, side: -2.2 }, { type: "rock", t: 0.94, side: 2.0 },
      { type: "snowPine", t: 0.2, side: -1.9 }, { type: "snowPine", t: 0.44, side: 1.9 },
      { type: "snowPine", t: 0.9, side: -1.8 }, { type: "snowPine", t: 0.52, side: -1.9 },
      { type: "rockArch", t: 0.1, side: 2.6, scale: 1.3 }, { type: "rockArch", t: 0.78, side: -2.5, scale: 1.1 },
      { type: "balloon", t: 0.3, side: 1.4 }, { type: "balloon", t: 0.68, side: -1.4 },
      // K14 · crowd tuple mirrors its grandstand exactly (see pizza-beach)
      { type: "grandstand", t: 0.982, side: 2, y: -0.2 }, { type: "crowdA", t: 0.982, side: 2, y: -0.2 },
      { type: "grandstand", t: 0.994, side: -2, y: -0.2 }, { type: "crowdA", t: 0.994, side: -2, y: -0.2 },
      { type: "grandstand", t: 0.685, side: 2, y: -0.1, rot: -2.02 }, { type: "crowdA", t: 0.685, side: 2, y: -0.1, rot: -2.02 },
      { type: "flagline", t: 0.988, side: 1.55, y: -0.2 }, { type: "flagline", t: 0.988, side: -1.55, y: -0.2 },
    ],
    billboards: [
      { t: 0.12, side: 1.7, lines: ["NO SECOND BEST"], fg: "#F7931A", fontSize: 52 },
      { t: 0.2, side: -1.7, lines: ["ALTITUDE:", "DECADES"], fg: "#FFD166", fontSize: 48 },
      { t: 0.48, side: -1.7, lines: ["ONE CHAIR PEAK", "DECADES NOT DAYS"], fg: "#FFD166", fontSize: 42 },
      { t: 0.56, side: 1.6, lines: ["DO NOT SELL", "THE VIEW"], fg: "#F7931A", fontSize: 46 },
      { t: 0.86, side: 1.7, lines: ["THE VIEW HOLDS"], fg: "#7DE3FF", fontSize: 48 },
      { t: 0.9, side: -1.7, lines: ["GRAVITY IS FUD"], fg: "#F7931A", fontSize: 50 },
    ],
    sky: "aurora",
  },
  {
    id: "schiff-gold-mine",
    name: "Schiff's Gold Mine",
    world: "corporate",
    music: "goldmine",
    laps: 4,
    width: 14,
    ridge: 35,
    fogFar: 280,
    theme: "goldmine",
    boss: "schiff",
    intro: "Gold brick road, vault doors, and the last bear standing. Schiff waits.",
    tip: "Gold bars on the racing line. He stacked them there on purpose.",
    pts: [
      [0, 0.8, 0], [-4, 1.4, 78], [12, 2.4, 140], [62, 3.4, 164], [116, 3, 138],
      [134, 2, 82], [112, 1.4, 28], [136, 1.8, -30], [112, 2.8, -84],
      [58, 3.8, -106], [2, 3, -88], [-44, 2.2, -110], [-86, 1.6, -78],
      [-88, 1, -22], [-50, 0.8, 2],
    ],
    hillAmp: 1.7,
    obstacles: [
      { type: "goldStack", t: 0.2, side: 0.35 }, { type: "goldStack", t: 0.45, side: -0.4 },
      { type: "goldStack", t: 0.7, side: 0.3 }, { type: "goldStack", t: 0.88, side: -0.3 },
      { type: "minecartProp", t: 0.33, side: -0.2 }, { type: "minecartProp", t: 0.77, side: 0.25 },
    ],
    // signature air: the DYNAMITE LAUNCH (h 6.5 x1.25) · the 0.66 gold
    // stack moved to 0.7, clear of the ground landing corridor
    boost: [{ t: 0.28, side: 0 }, { t: 0.51, side: 0 }, { t: 0.72, side: 0 }],
    jumps: [{ t: 0.55, h: 6.5, boost: 1.25 }],
    // THE MOLTEN VAULT: past the tunnel the mine opens over a river of
    // molten gold · five thousand years of momentum, straight down
    chasms: [{ t0: 0.49, t1: 0.63, w: 42, depth: 26, glow: "#FFB84D" }],
    gaps: [{ t0: 0.553, t1: 0.585 }],
    hazards: [{ t0: 0.55, t1: 0.62, side: "out" }, { t0: 0.55, t1: 0.62, side: "in" }],
    tunnels: [{ t0: 0.29, t1: 0.4 }],
    boxes: [0.16, 0.5, 0.84],
    sats: [
      { t0: 0.08, t1: 0.15, side: 0.5 }, { t0: 0.38, t1: 0.46, side: -0.5 },
      { t0: 0.595, t1: 0.66, side: 0.45 }, { t0: 0.9, t1: 0.96, side: -0.4 },
    ],
    props: [
      // a colossal vault door stands in the gorge wall over the molten river
      { type: "vaultDoor", t: 0.56, side: 3.4, scale: 5.5, y: -26.3 },
      { type: "goldStack", t: 0.3, side: 6, scale: 7, y: -2 },
      { type: "goldStack", t: 0.52, side: 2.8, scale: 3.4, y: -20.4 },
      { type: "goldStack", t: 0.58, side: -3.0, scale: 3.0, y: -20.4 },
      { type: "goldRock", t: 0.04, side: 2.1 }, { type: "goldRock", t: 0.12, side: -2.3 },
      { type: "goldRock", t: 0.24, side: 2.5 }, { type: "goldRock", t: 0.36, side: -2.1 },
      { type: "goldRock", t: 0.5, side: 2.2 }, { type: "goldRock", t: 0.6, side: -2.4 },
      { type: "goldRock", t: 0.7, side: 2.3 }, { type: "goldRock", t: 0.82, side: -2.2 },
      { type: "goldRock", t: 0.92, side: 2.1 },
      { type: "vaultDoor", t: 0.42, side: 1.9, scale: 1.2 }, { type: "vaultDoor", t: 0.8, side: -1.9, scale: 1.1 },
      { type: "goldStack", t: 0.1, side: 1.7 }, { type: "goldStack", t: 0.55, side: -1.7 },
      { type: "goldStack", t: 0.9, side: -1.8 },
      { type: "derrick", t: 0.16, side: 2.4 }, { type: "derrick", t: 0.68, side: -2.4 },
      { type: "minecartProp", t: 0.28, side: 1.8 },
      { type: "streetLamp", t: 0.18, side: -1.4 }, { type: "streetLamp", t: 0.62, side: 1.4 },
      { type: "balloon", t: 0.35, side: 1.4 }, { type: "balloon", t: 0.74, side: -1.4 },
      // K14 · crowd tuple mirrors its grandstand exactly (see pizza-beach)
      { type: "grandstand", t: 0.982, side: 2, y: -0.2 }, { type: "crowdA", t: 0.982, side: 2, y: -0.2 },
      { type: "grandstand", t: 0.994, side: -2, y: -0.2 }, { type: "crowdA", t: 0.994, side: -2, y: -0.2 },
      { type: "grandstand", t: 0.475, side: -2, y: -0.2, rot: -2.4 }, { type: "crowdA", t: 0.475, side: -2, y: -0.2, rot: -2.4 },
      { type: "flagline", t: 0.988, side: 1.55, y: -0.2 }, { type: "flagline", t: 0.988, side: -1.55, y: -0.2 },
    ],
    billboards: [
      { t: 0.47, side: -1.7, lines: ["FIVE THOUSAND", "YEARS DEEP"], fg: "#F5C542", fontSize: 44 },
      { t: 0.07, side: -1.7, lines: ["SOUND MONEY"], fg: "#F5C542", flicker: ["OLD MONEY"], fontSize: 56 },
      { t: 0.16, side: 1.7, lines: ["SHINY", "YET SLOW"], fg: "#F5C542", fontSize: 50 },
      { t: 0.4, side: 1.7, lines: ["GOLD: 5000 YEARS", "OF DILUTION"], fg: "#F5C542", fontSize: 44 },
      { t: 0.645, side: 1.6, lines: ["VAULT FEES", "DUE MONTHLY"], fg: "#C99A1E", fontSize: 44 },
      { t: 0.68, side: -1.7, lines: ["BARBAROUS", "RELIC LANE"], fg: "#C99A1E", fontSize: 48 },
      { t: 0.9, side: 1.7, lines: ["HODL GOLD*", "*RESULTS MAY VARY"], fg: "#F5C542", fontSize: 40 },
    ],
    sky: "mine",
  },
];

// ---------------------------------------------------------------------------
// COPY · every player-facing string. House rules: no em dashes, middle dot
// separators, numbers spelled out in lore copy.
// ---------------------------------------------------------------------------

export const COPY = {
  intro:
    "The Orange Circuit cracked when the bears scattered the signal. " +
    "Team Bitcoin against Team Fiat. One chair at the summit. " +
    "Unlock the ghost of the protocol. There is no second best.",
  teams: { btc: "TEAM BITCOIN", fiat: "TEAM FIAT" },
  tagline: TAGLINE,
  victory: ["TIMELINE RESTORED", "ORANGE PILLED", "WE CALL THEM STACKERS NOW"],
  dnf: "Volatility is a feature. Rejoin the grid.",
  countdown: ["3", "2", "1", "GO"],
  // RACE SCHOOL · the first-play coach (2026-07-21). Lines are arrays of
  // plain strings and {k:"KEY"} chips so coach.js can render key glyphs
  // without any HTML strings. Copy house rules apply: no em dashes, the
  // middot is the separator.
  coach: {
    eyebrow: "RACE SCHOOL",
    rocketKb: [{ k: "W" }, " on the 1 · release nothing · ROCKET START"],
    rocketGas: ["tap ", { k: "GAS" }, " on the 1 · ROCKET START"],
    rocketAuto: ["hold ", { k: "BRAKE" }, " · release on the 1 · ROCKET START"],
    rocketDone: "ROCKET START · learned",
    driftKb: ["hold ", { k: "SHIFT" }, " through this corner · DRIFT"],
    driftTouch: ["hold ", { k: "DRIFT" }, " through this corner"],
    driftRelease: ["release ", { k: "SHIFT" }, " now · MINI TURBO"],
    driftReleaseTouch: ["let go of ", { k: "DRIFT" }, " · MINI TURBO"],
    driftDone: "MINI TURBO · free speed, no fees",
    itemKb: ["fire it with ", { k: "SPACE" }],
    itemTouch: ["tap ", { k: "ITEM" }, " to fire it"],
    itemDone: "SENT",
    sats: "sats raise your TOP SPEED · stack all 10",
    gap: "THE ROAD DROPS OUT AHEAD · full throttle",
  },
  // the last-lap banner speaks bitcoin ("one more block to confirm") ·
  // the HUD lap chip stays "LAP x/y" so new players never guess
  lapFinal: "FINAL BLOCK",
  wrongWay: "WRONG WAY · zoom out",
  tips: [
    "Drift like your time preference depends on it.",
    "Volatility is a feature. So is drifting.",
    "There is no second best. There is second place.",
    "Hold the racing line like you hold your keys.",
    "Stack sats on the track. Top speed follows.",
    "Zoom out. Then take the inside line.",
    "The chair does not flinch. Neither should your thumbs.",
    "Paper hands drop peels. Diamond hands drive around them.",
    "Every dip is a discount. Every ramp is a rip.",
    "Boost pads settle instantly. No middlemen.",
    "The Bear of 2014 fears one thing: your late apex.",
    "Gold is heavy. That is the whole joke, and the whole physics engine.",
  ],
  raceEvents: {
    overtake: ["POSITION SECURED", "FLIPPENING", "UP ONLY"],
    hit: ["REKT", "LIQUIDATED", "TEMPORARY SETBACK"],
    boost: ["FULL SEND", "HIGH VOLTAGE", "NUMBER GO UP"],
    chair: ["ONE CHAIR MODE", "CONVICTION UNBREAKABLE"],
    sat: ["+SAT"],
    fall: ["OVERBOARD · rescued", "OFF THE CHAIN · rescued", "LIQUIDATED THE WET WAY", "NOT YOUR KEYS · rescued anyway"],
    bigAir: ["BIG AIR", "TO THE MOON", "ESCAPE VELOCITY"],
    // cause-flavored hit lines: the item that got you names the insult
    causes: {
      peel: ["PAPER HANDS", "SLIPPED ON THE TOP"],
      headline: ["FRONT PAGE FUD", "HIT PIECE LANDED"],
      fud: ["FUD TOOK HOLD", "TEMPORARY SETBACK"],
      ratio: ["RATIOED", "COMMUNITY NOTED"],
      goldbar: ["GOLD IS HEAVY", "BARBAROUS RELIC"],
      hammer: ["REGULATED", "COURT IS IN SESSION"],
    },
    pill: {
      stole: "ORANGE PILLED · their item is yours",
      consolation: "ORANGE PILLED · consolation laser",
      robbed: "ORANGE PILLED · your item is gone",
    },
  },
  results: {
    win: "FIRST · there was never a second best",
    podium: "PODIUM · the timeline approves",
    mid: "MID FIELD · zoom out, re-enter",
    back: "BACK OF GRID · every dip is a discount",
    challengeLabel: "CHALLENGES",
    challengeNext: "NEXT",
    challengeDone: "SHELF COMPLETE",
    crownLabel: "TODAY'S CROWN",
  },
  // TODAY'S BOARD · the menu's social leaderboard panel (2026-07-17)
  menuBoard: {
    title: "TODAY'S BOARD",
    syncing: "syncing the grid…",
    racingAs: "RACING AS",
    beFirst: "nobody has posted yet · the crown is sitting there",
    posted: "racers posted today",
    setTime: "set your time →",
    behind: "behind",
    reclaim: "{name} took P{rank} from you",
    reclaimCta: "RECLAIM IT →",
    linkUpsell: "Link X below to hold this place under your real name",
    crownGap: "off the crown",
  },
  // dare interstitial (?ghost=<id> deep links · 2026-07-16)
  dare: {
    label: "INCOMING DARE",
    sub: "Beat this ghost line and the bragging rights change hands.",
  },
  // THE GENESIS RUN · the story finale (2026-07-17). Unlocking Satoshi
  // opens a one-off dawn race on Genesis Circuit: the ghost of the
  // protocol against every rival returned at once, bosses included.
  // Victory rolls the credits; the flag lives in progress.genesisRun.
  finale: {
    hubTitle: "THE GENESIS RUN",
    hubOpen: "The signal calls. Answer it at dawn.",
    hubDone: "The signal is safe. Run it again anytime.",
    trackName: "The Genesis Run",
    intro: [
      "The chair sits empty. The bears circle one last time.",
      "Every rival you beat is back on the same grid at once, and the ghost of the protocol takes the wheel.",
      "Dawn over Block Zero. Win here and the signal is safe for good.",
    ],
    start: "ANSWER THE SIGNAL →",
    notYet: "NOT YET",
    defeat: "THE SIGNAL FADES · the grid holds it for now. Answer it again.",
    retry: "ANSWER IT AGAIN →",
    victory: "THE SIGNAL WAS NEVER LOST",
    credits: [
      "BITCOIN KART",
      "",
      "In 2008 a signal appeared in the noise.",
      "A whitepaper. A genesis block. A pizza worth a fortune.",
      "The winter of 2014 tried to bury it. It compounded instead.",
      "Headlines wrote four hundred obituaries. The blocks kept coming.",
      "Suits arrived in glass towers and found the chair already taken.",
      "One chair. Ten racers. No second best.",
      "",
      "TEAM BITCOIN",
      "Michael Saylor · Phong Le · The Bitcoin Wizard",
      "Jack Mallers · Nayib Bukele · Satoshi Nakamoto",
      "",
      "TEAM FIAT",
      "Peter Schiff · Jamie Dimon · Elizabeth Warren",
      "Warren Buffett · Mark Cuban",
      "",
      "RIVALS OF THE ROAD",
      "The Bear of 2014 · The Headline",
      "",
      "A GALAXY MIND ARCADE CABINET",
      "built with Claude Fable · zero dependencies, one browser",
      "unofficial fan game and affectionate parody",
      "not financial advice · no Nintendo affiliation",
      "",
      "the signal was never lost",
      "21,000,000 · forever",
    ],
    ngPlus: "NEW GAME PLUS · MIRROR MODE waits in Settings. Every track, flipped. The far side of the chart.",
    replay: "RUN IT BACK →",
    toAtoll: "BACK TO THE ATOLL →",
    share: "I finished the Bitcoin Kart story. Dawn on Genesis Circuit, every rival at once, and the signal was never lost. galaxymind.space/bitcoin-kart",
  },
  // -----------------------------------------------------------------------
  // STORY MODE · THE ORANGE CIRCUIT (2026-07-21) · cinematic story beats.
  // Cards ride the camera reels (hub arrival, gate openings, boss theater,
  // the signal recovery) · `at` is the reel progress 0..1 where a card
  // lands. Player-agnostic: any driver, either team. First-visit beats
  // gate on SAVE.progress.storySeen. House rules: no em dashes, no "88".
  // -----------------------------------------------------------------------
  story: {
    logline: "Recover the scattered signal across three worlds, then answer the dawn call at Block Zero.",
    hubArrival: {
      label: "TIMECHAIN ATOLL",
      cards: [
        { at: 0.02, label: "TIMECHAIN ATOLL", line: "The Orange Circuit cracked. The bears did not steal the signal. They scattered it." },
        { at: 0.3, line: "Orange Balloons hold the pieces. Race the memory, the mania, and the capture." },
        { at: 0.56, line: "Three gates. Three bosses of doubt. One chair at the summit." },
        { at: 0.82, title: "THE ORANGE CIRCUIT", line: "Recover the ghost of the protocol. There is no second best." },
      ],
    },
    // world chapters · a one-shot dawn-of-chapter card over the first race
    worlds: {
      genesis: { chapter: "CHAPTER 1 · THE MEMORY", line: "Pizza grease, wet docks, and a winter that forged diamond hands." },
      neon: { chapter: "CHAPTER 2 · THE MANIA", line: "Number goes up. Sense goes sideways. Bring a racing line." },
      corporate: { chapter: "CHAPTER 3 · THE CAPTURE", line: "Balance sheets found an exit. You found the apex." },
    },
    // gate-opening reels · played on the atoll when a world first unlocks
    gates: {
      neon: {
        cards: [
          { at: 0.05, label: "THE NEON GATE", line: "Five balloons crack the seal across the water." },
          { at: 0.5, title: "MANIA AHEAD", line: "The city of candles wakes. Sense sold separately." },
        ],
      },
      corporate: {
        cards: [
          { at: 0.05, label: "THE CORPORATE GATE", line: "Ten balloons open the towers." },
          { at: 0.5, title: "SUITS ON THE GRID", line: "Balance sheets found an exit. The chair is watching." },
        ],
      },
    },
    // boss theater · stare-down card + first-clear defeat line
    bosses: {
      bear2014: {
        title: "WINTER NEVER LEFT",
        pre: "Winter never left. It just learned your name.",
        defeat: "Frost breaks. A cyan gate wakes across the water.",
        surge: "FROST SURGE",
      },
      headline: {
        title: "BREAKING: YOU",
        pre: "Declared dead again. Make the retraction earn it.",
        defeat: "Page one takes it back. The towers unlock.",
        surge: "BREAKING NEWS",
      },
      schiff: {
        title: "LAST BEAR STANDING",
        pre: "Five thousand years of momentum, allegedly. One chair left.",
        defeat: "The newsletter can wait. The signal returns.",
      },
    },
    satoshiUnlock: {
      cards: [
        { at: 0.04, label: "SIGNAL RECOVERED", line: "Corporate door open. Schiff cleared. Twelve balloons stacked." },
        { at: 0.34, line: "The scattered pieces click. A quiet kart rolls onto the peak." },
        { at: 0.66, title: "SATOSHI NAKAMOTO", line: "The ghost of the protocol is playable. The eleventh seat was always reserved." },
      ],
    },
    goldenHour: {
      cards: [
        { at: 0.05, label: "GOLDEN HOUR", line: "Every balloon. Every level. The ledger is full." },
        { at: 0.48, title: "GOLDEN SATOSHI", line: "The ghost turns gold and the atoll tips into sunset." },
      ],
    },
  },
  adventure: {
    hubName: "Timechain Atoll",
    balloonLabel: "Orange Balloons",
    doorLocked: "Sealed. The atoll wants more Orange Balloons.",
    bossLocked: "The gate glows. Earn a balloon on every track in this world first.",
    // Bodies ride after "BOSS CLEARED · " on the results strip · do not
    // start with "Cleared" or the line reads "BOSS CLEARED · Cleared…"
    bossBeaten: "The bear saw the light.", // fallback · per-boss lines below
    bossCleared: {
      bear2014: "The bear saw the light.",
      headline: "The retraction ran on page one.",
      schiff: "He still calls it a pet rock. From second place.",
    },
    satoshiLocked: "??? · Finish the Orange Circuit. Recover the signal.",
    satoshiUnlocked: "SIGNAL RECOVERED · Satoshi joins the grid.",
    ruleFound: "RULE TOKEN RECOVERED · the codex grows",
    // 100% reward (2026-07-18): every Orange Balloon collected + every
    // level cleared gilds Satoshi and turns the atoll to golden hour
    goldenSatoshi: "GOLDEN SATOSHI UNLOCKED",
    goldenSatoshiSub: "Every balloon. Every level. The ghost turns to gold and the atoll to sunset.",
  },
  shareLines: {
    beatSchiff: "I just beat Schiff in Bitcoin Kart as {driver}. galaxymind.space/bitcoin-kart",
    satoshi: "I unlocked Satoshi in Bitcoin Kart. galaxymind.space/bitcoin-kart",
    // lines with {url} carry a per-run share-card link (see cardSeg in
    // main.js) so the tweet unfurls a card frozen to that exact run ·
    // when the run's dare ghost mints, the SAME card link carries the
    // ~g id and the card page CTA becomes RACE THIS GHOST. The copy is a
    // dare, not a brag: a brag gives the timeline nothing to do
    // (research decision 2026-07-16).
    win: "P1 at {track}. {driver} left the grid coughing on orange smoke. My ghost is on the track. Race it: {url}",
    almost: "P2 at {track} as {driver}. One apex short of the chair. My ghost is waiting for you: {url}",
    podium: "P3 at {track} as {driver}. The podium is base camp. Think you can pass my ghost? {url}",
    // P4-P8 · share-funnel audit 2026-07-26: most NEW players finish
    // here and previously had no share affordance at all. A losing
    // ghost is BETTER dare economics than a perfect P1 (beatable dares
    // propagate the chain · unbeatable ones terminate it).
    field: "P{rank} at {track} as {driver}. The grid humbled me. My ghost needs avenging: {url}",
    cup: "{cup} trophy secured in Bitcoin Kart as {driver}. galaxymind.space/bitcoin-kart",
    timeTrial: "{track} in {time}. My ghost is on the track and it does not slow down. Catch it: {url}",
    daily: "Daily Circuit no.{day}: {time} on {track}. The whole world races this exact combo today. Race my ghost: {url}",
    // dare-chain lines (challenge mode results · {name} is the ghost's
    // owner, {url} the NEW dare minted from this run)
    dareWin: "I hunted down {name}'s ghost at {track}. {time}. My ghost carries the dare now: {url}",
    dareLost: "{name}'s ghost got away from me at {track}. {time}. Someone avenge this: {url}",
  },
  disclaimer:
    "GALAXY MIND ARCADE · BITCOIN KART · unofficial fan game and affectionate parody · " +
    "not affiliated with Strategy Inc., Michael Saylor, Phong Le, Adam Livingston, Jack Mallers, " +
    "Nayib Bukele, Peter Schiff, Jamie Dimon, Elizabeth Warren, Warren Buffett, Mark Cuban, " +
    "or any depicted person or company · not financial advice · educational entertainment · " +
    "no Nintendo affiliation · not affiliated with Nintendo",
};

// Codex: Rule Tokens paraphrasing the Super Saylor 21 Rules in kart idiom.
// One per event, twelve total (the brief allows nine to twelve).
export const CODEX = [
  { id: 1, event: "pizza-beach", title: "MONETARY ENERGY", body: "Store your work in a battery that does not leak. Then floor it." },
  { id: 2, event: "genesis-circuit", title: "NO SECOND BEST", body: "One network won digital scarcity. One kart crosses first. Do not shop the runners up." },
  { id: 3, event: "gox-docks", title: "HOLD YOUR OWN KEYS", body: "Not your keys, not your kart. Custody your racing line yourself." },
  { id: 4, event: "winter-2014", title: "SURVIVE THE WINTER", body: "Drawdowns are tuition. The long winter forged the faithful, and the best drivers." },
  { id: 5, event: "blocksize-fog", title: "CONSENSUS IS THE ROAD", body: "Forks split the fog, not the destination. Both lanes rhyme. Pick one and commit." },
  { id: 6, event: "euphoria-neon", title: "VOLATILITY IS THE FEE", body: "Volatility is the price of performance. Pay it in drift, collect it in boost." },
  { id: 7, event: "printer-runway", title: "THE PRINTER ALWAYS LOSES", body: "They print paper. You stack sats. On a long enough runway, sats win." },
  { id: 8, event: "obituary-alley", title: "OUTLIVE THE HEADLINE", body: "Declared dead four hundred seventy three times. Still setting lap records." },
  { id: 9, event: "glass-tower-loop", title: "BALANCE SHEET GRAVITY", body: "Capital flows downhill into the hardest asset. Take the inside of that curve." },
  { id: 10, event: "etf-dawn", title: "THE DOOR OPENS SLOWLY", body: "First they ignore the grid, then they ring the bell at dawn. Be early anyway." },
  { id: 11, event: "one-chair-peak", title: "HOLD THE LINE", body: "The chair does not flinch when the chart does. Neither does a good apex." },
  { id: 12, event: "schiff-gold-mine", title: "FOREVER IS THE EXIT", body: "There is no exit strategy because there is no exit. Cross the line, keep driving." },
];

// Challenges: DKR-style named feats, checked at every finish line and
// persisted once (SAVE.progress.challenges). Cosmetic badges on the
// shelf · they never gate content, so balloon math stays untouched.
export const CHALLENGES = [
  { id: "diamond-hands", title: "DIAMOND HANDS", desc: "Win a race without using a single item." },
  { id: "team-fiat", title: "TRADING PLACES", desc: "Win a race driving for Team Fiat." },
  { id: "no-chair", title: "BARE HANDS AT THE SUMMIT", desc: "Beat Schiff at the Gold Mine without sitting in the One Chair." },
  { id: "full-stack", title: "FULL STACK", desc: "Win with all ten sats in the bag." },
  { id: "moon-lander", title: "MOON LANDING", desc: "Catch big air three times in one race." },
  { id: "ghostbuster", title: "GHOSTBUSTER", desc: "Beat your own ghost on a Daily Circuit." },
  // engagement pack (2026-07-21) · four more teachers, still cosmetic
  { id: "rocket-start", title: "IGNITION", desc: "Win a race after a perfect rocket start." },
  { id: "ghost-rider", title: "GHOST RIDER", desc: "Win a full-grid race as Satoshi." },
  { id: "mirror-master", title: "MIRROR MASTER", desc: "Win any race in Mirror mode." },
  { id: "full-send", title: "NO BRAKES", desc: "Win a race in the FULL SEND engine class." },
];

// Balloon awards: best result per event grants balloons (not stacking).
// The third balloon is the DKR-style challenge: win WITH a full sat stack.
export function balloonsForResult(rank, isBoss, fullSats) {
  if (isBoss) return rank === 1 ? (fullSats ? 3 : 2) : 0;
  if (rank === 1) return fullSats ? 3 : 2;
  if (rank <= 3) return 1;
  return 0;
}

// ---------------------------------------------------------------------------
// Engine classes (the 50/100/150cc analog) + the Daily Circuit.
// ---------------------------------------------------------------------------

export const CLASSES = {
  sats: { name: "SATS", mult: 0.88, desc: "relaxed pace · learn the lines" },
  bits: { name: "BITS", mult: 1.0, desc: "the standard grid · fair fight" },
  fullsend: { name: "FULL SEND", mult: 1.14, desc: "faster field · sharper rivals" },
};
export const MIRROR_DESC = "mirror flips every track left to right";

// Daily Circuit: one deterministic track + class + mirror combo per UTC
// day, same for everyone. Day numbering shares the sitewide arcade epoch
// (src/lib/gauntlet-day.ts · drift-guarded by scripts/test-bitcoin-kart.ts).
export const DAILY_EPOCH_DAY = Math.floor(Date.UTC(2026, 6, 8) / 86400000);

export function kartDayNumber(utcMs) {
  return Math.floor(utcMs / 86400000) - DAILY_EPOCH_DAY + 1;
}

// stride 5 is coprime to 12, so the rotation visits every track before
// repeating. Class and mirror come off a Knuth-hash of the day rather
// than day%3 / day%2: plain moduli both divide 12, which would lock each
// track to ONE permanent class+mirror combo (review finding 2026-07-14).
export function dailyCombo(day) {
  const t = (((day * 5 + 2) % 12) + 12) % 12;
  const h = Math.imul(day, 2654435761) >>> 0;
  const klass = ["bits", "sats", "fullsend"][h % 3];
  return { trackId: TRACKS[t].id, klass, mirror: ((h >>> 3) & 1) === 1 };
}

// Daily board score = KART_BASE_MS - finish ms, so faster runs rank higher
// under the arcade API's only-improves ZADD GT (drift-guarded vs the route).
export const KART_BASE_MS = 600000;

export const SETTINGS_DEFAULTS = {
  music: 0.8,
  sfx: 0.9,
  musicOn: true, // persistent header toggle · gates musicGain
  sfxOn: true,   // persistent header toggle · gates sfxGain (fx, engine, ambience)
  mute: false,   // retired: the two toggles above superseded it (migrated at boot)
  quality: "auto", // auto | high | medium | low
  reduceFx: false, // initialized from prefers-reduced-motion at boot
  touchStyle: "joystick", // joystick (floating) | slider (fixed zone) · Super Saylor lesson: joystick default
  coachTips: true, // RACE SCHOOL first-play coach · once-ever lessons, off switch in settings
  // difficulty (2026-07-22): auto = dynamic assist (the field eases when a
  // player keeps finishing deep, bosses blink after repeat losses) ·
  // relaxed = gentle band always (non-boss) · standard = no assists
  difficulty: "auto", // auto | relaxed | standard
  autoAccel: true, // touch only: gas is automatic, right thumb owns DRIFT
  haptics: true, // navigator.vibrate on hits/boosts (touch only)
  raceClass: "bits", // engine class for quick/GP/TT (CLASSES key)
  raceMirror: false, // mirror mode for quick/GP/TT
};

export function trackById(id) {
  for (const t of TRACKS) if (t.id === id) return t;
  return null;
}

export function driverById(id) {
  for (const d of ROSTER) if (d.id === id) return d;
  return BOSSES[id] || null;
}
