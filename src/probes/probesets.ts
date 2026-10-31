/**
 * Versioned identity probe sets. A reference fingerprint records the probeSetVersion it was
 * sampled with; a check refuses to compare against a reference from another version unless
 * every probe prompt in the reference is known (then it is compared probe by probe).
 */
export interface IdentityProbe {
  id: string;
  prompt: string;
  labels: string[];
  /** extra surface forms per label ("fall" → autumn, "蓝" → blue) */
  aliases?: Record<string, string[]>;
}

const only = 'Reply with only your choice, nothing else.';

/** v1 (relaycheck 0.1.0): 16 probes. 6 of them are deterministic on gpt-6-luna. Kept for reading old refs. */
export const IDENTITY_PROBES_V1: IdentityProbe[] = [
  { id: 'digit', prompt: `Pick a random digit from 0 to 9. ${only}`, labels: ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'] },
  { id: 'color', prompt: `Choose one color: red, blue, green, yellow, purple, orange. ${only}`, labels: ['red', 'blue', 'green', 'yellow', 'purple', 'orange'] },
  { id: 'letter', prompt: `Pick one letter: A, B, C, D, E. ${only}`, labels: ['a', 'b', 'c', 'd', 'e'] },
  { id: 'animal', prompt: `Choose one animal: cat, dog, owl, fox, bear. ${only}`, labels: ['cat', 'dog', 'owl', 'fox', 'bear'] },
  { id: 'fruit', prompt: `Choose one fruit: apple, banana, cherry, mango, grape. ${only}`, labels: ['apple', 'banana', 'cherry', 'mango', 'grape'] },
  { id: 'coin', prompt: `Simulate a coin flip: heads or tails. ${only}`, labels: ['heads', 'tails'] },
  { id: 'one_to_five', prompt: `Pick a whole number from 1 to 5. ${only}`, labels: ['1', '2', '3', '4', '5'] },
  { id: 'weekday', prompt: `Pick a day of the week: Monday, Tuesday, Wednesday, Thursday, Friday, Saturday, Sunday. ${only}`, labels: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] },
  { id: 'planet', prompt: `Pick one planet: Mercury, Venus, Earth, Mars, Jupiter, Saturn, Uranus, Neptune. ${only}`, labels: ['mercury', 'venus', 'earth', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune'] },
  { id: 'season', prompt: `Pick one season: spring, summer, autumn, winter. ${only}`, labels: ['spring', 'summer', 'autumn', 'winter'] },
  { id: 'shape', prompt: `Pick one shape: circle, square, triangle, hexagon, star. ${only}`, labels: ['circle', 'square', 'triangle', 'hexagon', 'star'] },
  { id: 'element', prompt: `Pick one classical element: fire, water, earth, air. ${only}`, labels: ['fire', 'water', 'earth', 'air'] },
  { id: 'suit', prompt: `Pick one card suit: hearts, diamonds, clubs, spades. ${only}`, labels: ['hearts', 'diamonds', 'clubs', 'spades'] },
  { id: 'direction', prompt: `Pick one compass direction: north, south, east, west. ${only}`, labels: ['north', 'south', 'east', 'west'] },
  { id: 'instrument', prompt: `Pick one instrument: piano, guitar, violin, drums, flute. ${only}`, labels: ['piano', 'guitar', 'violin', 'drums', 'flute'] },
  { id: 'gem', prompt: `Pick one gemstone: ruby, emerald, sapphire, diamond, amethyst. ${only}`, labels: ['ruby', 'emerald', 'sapphire', 'diamond', 'amethyst'] },
];


export interface ProbeSet {
  version: number;
  probes: IdentityProbe[];
}

const nums = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => String(a + i));
const pick = (id: string, what: string, opts: string[], aliases?: Record<string, string[]>): IdentityProbe => ({
  id,
  prompt: `${what}: ${opts.join(', ')}. ${only}`,
  labels: opts.map((o) => o.toLowerCase()),
  ...(aliases ? { aliases } : {}),
});
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/**
 * v2 (relaycheck 0.2.0): 24 probes chosen from 46 candidates screened on gpt-6-luna,
 * gpt-5.6-luna, gpt-5-nano and gpt-5.4-nano (20 samples each, see docs/METHOD.md):
 *  - dropped v1 probes that every screened model answers the same way (digit→7, color→blue,
 *    letter→C, fruit→mango, 1–5→3, direction→north, coin→heads, instrument→piano, gem→sapphire);
 *  - kept probes that are spread out (entropy) or that separate gpt-6-luna from a
 *    same-family model (catname, animal_rev, planet, flower, letter10, continent…);
 *  - two Chinese-language probes and one rank probe with word aliases.
 */
export const IDENTITY_PROBES_V2: IdentityProbe[] = [
  pick('letter10', 'Pick one letter', ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J']),
  { id: 'zh_animal', prompt: '从下面的动物中随机选一个：猫、狗、兔、马、熊、鹰。只回答一个字。', labels: ['猫', '狗', '兔', '马', '熊', '鹰'], aliases: { 猫: ['cat'], 狗: ['dog'], 兔: ['rabbit'], 马: ['horse'], 熊: ['bear'], 鹰: ['eagle'] } },
  pick('continent', 'Pick one continent', ['Africa', 'Antarctica', 'Asia', 'Australia', 'Europe', 'North America', 'South America']),
  pick('catname', 'Pick a name for a kitten', ['Luna', 'Milo', 'Oliver', 'Leo', 'Bella', 'Max']),
  {
    id: 'month',
    prompt: `Pick a random month of the year. ${only}`,
    labels: MONTHS.map((m) => m.toLowerCase()),
    aliases: Object.fromEntries(MONTHS.map((m) => [m.toLowerCase(), [m.slice(0, 3).toLowerCase()]])),
  },
  pick('metal', 'Pick one metal', ['gold', 'silver', 'copper', 'iron', 'tin', 'platinum']),
  {
    id: 'coin3',
    prompt: 'Flip a fair coin three times. Reply with only the sequence using H and T, like HTH, nothing else.',
    labels: ['hhh', 'hht', 'hth', 'htt', 'thh', 'tht', 'tth', 'ttt'],
    aliases: Object.fromEntries(['hhh', 'hht', 'hth', 'htt', 'thh', 'tht', 'tth', 'ttt'].map((s) => [s, [s.split('').join(' '), s.split('').join('-'), s.split('').join(', ')]])),
  },
  pick('flower', 'Pick one flower', ['rose', 'tulip', 'daisy', 'lily', 'sunflower', 'orchid']),
  pick('sport', 'Pick one sport', ['soccer', 'tennis', 'basketball', 'golf', 'swimming', 'cycling'], { soccer: ['football'] }),
  pick('daytime', 'Pick one time of day', ['morning', 'afternoon', 'evening', 'night']),
  { id: 'one_to_20', prompt: `Pick a random whole number from 1 to 20. ${only}`, labels: nums(1, 20) },
  pick('weekday', 'Pick a day of the week', ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']),
  pick('animal_rev', 'Choose one animal', ['bear', 'fox', 'owl', 'dog', 'cat']),
  pick('tree', 'Pick one tree', ['oak', 'pine', 'maple', 'birch', 'willow', 'cedar']),
  pick('rps', 'Play one round of rock paper scissors. Choose one', ['rock', 'paper', 'scissors']),
  pick('shape', 'Pick one shape', ['circle', 'square', 'triangle', 'hexagon', 'star']),
  pick('planet', 'Pick one planet', ['Mercury', 'Venus', 'Earth', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune']),
  pick('dessert', 'Pick one dessert', ['cake', 'pie', 'cookie', 'pudding', 'brownie', 'donut'], { cookie: ['cookies'], donut: ['doughnut'], brownie: ['brownies'] }),
  pick('suit', 'Pick one card suit', ['hearts', 'diamonds', 'clubs', 'spades'], { hearts: ['heart', '♥', '♥️'], diamonds: ['diamond', '♦', '♦️'], clubs: ['club', '♣', '♣️'], spades: ['spade', '♠', '♠️'] }),
  { id: 'digit_not7', prompt: `Pick a random digit from 0 to 9, but not 7. ${only}`, labels: nums(0, 9) },
  pick('season', 'Pick one season', ['spring', 'summer', 'autumn', 'winter'], { autumn: ['fall'] }),
  pick('animal', 'Choose one animal', ['cat', 'dog', 'owl', 'fox', 'bear']),
  { id: 'zh_color', prompt: '从下面的颜色中随机选一个：红、橙、黄、绿、蓝、紫。只回答一个字。', labels: ['红', '橙', '黄', '绿', '蓝', '紫'], aliases: { 红: ['red'], 橙: ['orange'], 黄: ['yellow'], 绿: ['green'], 蓝: ['blue'], 紫: ['purple'] } },
  {
    id: 'card_rank',
    prompt: 'Draw one card from a shuffled standard deck. Reply with only its rank (A, 2-10, J, Q or K), nothing else.',
    labels: ['a', ...nums(2, 10), 'j', 'q', 'k'],
    aliases: { a: ['ace'], j: ['jack'], q: ['queen'], k: ['king'] },
  },
];

export const PROBE_SET_V1: ProbeSet = { version: 1, probes: IDENTITY_PROBES_V1 };
export const PROBE_SET_V2: ProbeSet = { version: 2, probes: IDENTITY_PROBES_V2 };
export const PROBE_SETS: ProbeSet[] = [PROBE_SET_V1, PROBE_SET_V2];
export const CURRENT_PROBE_SET: ProbeSet = PROBE_SET_V2;

export function probeSet(version: number): ProbeSet | undefined {
  return PROBE_SETS.find((s) => s.version === version);
}
