import type { Redactor } from '../redact.js';
import type { Report } from '../types.js';

/** Machine-readable report including raw evidence. Always passes through the redactor. */
export function renderJson(r: Report, redactor: Redactor): string {
  return JSON.stringify(redactor.redactDeep(r), null, 2) + '\n';
}
