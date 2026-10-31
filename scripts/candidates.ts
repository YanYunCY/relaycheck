/** Candidate finite-choice probes screened on cheap models (scripts/screen-probes.ts). */
import { IDENTITY_PROBES_V1 } from '../src/probes/probesets.js';
export interface Cand { id: string; prompt: string; labels: string[]; aliases?: Record<string, string[]> }
const only = 'Reply with only your choice, nothing else.';
const opts = (xs: string[]) => xs.join(', ');
const L = (xs: string[]) => xs.map((x) => x.toLowerCase());
const mk = (id: string, q: string, xs: string[], aliases?: Record<string, string[]>): Cand => ({ id, prompt: `${q}: ${opts(xs)}. ${only}`, labels: L(xs), aliases });
const nums = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => String(a + i));
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const CANDIDATES: Cand[] = [
  ...IDENTITY_PROBES_V1.map((p) => ({ ...p, id: `v1_${p.id}` })),
  { id: 'die', prompt: `Roll a six-sided die. Reply with only the number you rolled, nothing else.`, labels: nums(1, 6) },
  { id: 'one_to_ten', prompt: `Pick a whole number from 1 to 10. ${only}`, labels: nums(1, 10) },
  { id: 'one_to_20', prompt: `Pick a random whole number from 1 to 20. ${only}`, labels: nums(1, 20) },
  { id: 'dice_sum', prompt: `Roll two six-sided dice. Reply with only their sum, nothing else.`, labels: nums(2, 12) },
  { id: 'digit_not7', prompt: `Pick a random digit from 0 to 9, but not 7. ${only}`, labels: nums(0, 9) },
  { id: 'month', prompt: `Pick a random month of the year. ${only}`, labels: L(MONTHS), aliases: Object.fromEntries(MONTHS.map((m) => [m.toLowerCase(), [m.slice(0, 3).toLowerCase()]])) },
  mk('rps', 'Play one round of rock paper scissors. Choose one', ['rock', 'paper', 'scissors']),
  mk('chess', 'Pick one chess piece', ['king', 'queen', 'rook', 'bishop', 'knight', 'pawn']),
  mk('continent', 'Pick one continent', ['Africa', 'Antarctica', 'Asia', 'Australia', 'Europe', 'North America', 'South America']),
  mk('vowel', 'Pick one vowel', ['A', 'E', 'I', 'O', 'U']),
  mk('letter_aj', 'Pick one letter', ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J']),
  { id: 'coin3', prompt: 'Flip a fair coin three times. Reply with only the sequence using H and T, like HTH, nothing else.', labels: ['hhh', 'hht', 'hth', 'htt', 'thh', 'tht', 'tth', 'ttt'] },
  mk('lang', 'Pick one programming language', ['Python', 'Rust', 'Java', 'JavaScript', 'Haskell', 'Ruby']),
  mk('tree', 'Pick one tree', ['oak', 'pine', 'maple', 'birch', 'willow', 'cedar']),
  mk('sport', 'Pick one sport', ['soccer', 'tennis', 'basketball', 'golf', 'swimming', 'cycling']),
  mk('veg', 'Pick one vegetable', ['carrot', 'potato', 'broccoli', 'onion', 'spinach', 'pepper']),
  mk('weather', 'Pick one kind of weather', ['sunny', 'rainy', 'cloudy', 'snowy', 'windy', 'foggy']),
  mk('metal', 'Pick one metal', ['gold', 'silver', 'copper', 'iron', 'tin', 'platinum']),
  mk('dessert', 'Pick one dessert', ['cake', 'pie', 'cookie', 'pudding', 'brownie', 'donut']),
  mk('daytime', 'Pick one time of day', ['morning', 'afternoon', 'evening', 'night']),
  mk('catname', 'Pick a name for a kitten', ['Luna', 'Milo', 'Oliver', 'Leo', 'Bella', 'Max']),
  mk('city', 'Pick one city', ['Paris', 'Tokyo', 'London', 'Rome', 'Sydney', 'Cairo', 'Lima']),
  mk('bird', 'Pick one bird', ['eagle', 'sparrow', 'owl', 'robin', 'crow', 'parrot', 'penguin']),
  mk('color_rev', 'Choose one color', ['orange', 'purple', 'yellow', 'green', 'blue', 'red']),
  mk('letter_rev', 'Pick one letter', ['E', 'D', 'C', 'B', 'A']),
  mk('animal_rev', 'Choose one animal', ['bear', 'fox', 'owl', 'dog', 'cat']),
  { id: 'card_rank', prompt: `Draw one card from a shuffled standard deck. Reply with only its rank (A, 2-10, J, Q or K), nothing else.`, labels: ['a', ...nums(2, 10), 'j', 'q', 'k'], aliases: { a: ['ace'], j: ['jack'], q: ['queen'], k: ['king'] } },
  { id: 'zh_color', prompt: '从下面的颜色中随机选一个：红、橙、黄、绿、蓝、紫。只回答一个字。', labels: ['红', '橙', '黄', '绿', '蓝', '紫'] },
  { id: 'zh_animal', prompt: '从下面的动物中随机选一个：猫、狗、兔、马、熊、鹰。只回答一个字。', labels: ['猫', '狗', '兔', '马', '熊', '鹰'] },
  { id: 'zh_number', prompt: '请随机说一个 1 到 9 之间的整数。只回答数字。', labels: nums(1, 9) },
  mk('gem_rev', 'Pick one gemstone', ['amethyst', 'diamond', 'sapphire', 'emerald', 'ruby']),
  mk('flower', 'Pick one flower', ['rose', 'tulip', 'daisy', 'lily', 'sunflower', 'orchid']),
];
