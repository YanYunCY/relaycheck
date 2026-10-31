import { PROBE_SETS } from '../probes/probesets.js';
import { hash32 } from '../rng.js';

/**
 * Built-in synthetic answer distributions for the mock relay.
 * "honest" plays the requested model; "swap" plays a different (cheaper) model:
 * same option set, but its favourite answers sit elsewhere.
 */
export type Persona = 'honest' | 'swap';

export function personaWeights(probeId: string, labels: string[], persona: Persona): number[] {
  const k = labels.length;
  const fav = hash32(`${probeId}:fav`) % k;
  const second = (fav + 1 + (hash32(`${probeId}:second`) % (k - 1))) % k;
  const shift = Math.max(1, Math.floor(k / 2));
  const f = persona === 'honest' ? fav : (fav + shift) % k;
  let s = persona === 'honest' ? second : (second + shift) % k;
  if (s === f) s = (f + 1) % k;
  return labels.map((_, i) => (i === f ? 8 : i === s ? 3 : 1));
}

export function personaDistribution(probeId: string, persona: Persona): Record<string, number> | null {
  const p = PROBE_SETS.flatMap((s) => s.probes).find((x) => x.id === probeId);
  if (!p) return null;
  const w = personaWeights(p.id, p.labels, persona);
  const total = w.reduce((a, b) => a + b, 0);
  return Object.fromEntries(p.labels.map((lab, i) => [lab, w[i] / total]));
}

export function displayLabel(label: string): string {
  return /^[0-9]+$/.test(label) ? label : label.length === 1 ? label.toUpperCase() : label[0].toUpperCase() + label.slice(1);
}
