import { describe, expect, it } from 'vitest';
import { parseArgs } from '../src/cli.js';
import { classify } from '../src/probes/identity.js';
import { modelEchoMatches } from '../src/probes/protocol.js';
import { Redactor, maskHost } from '../src/redact.js';
import { normalizeBaseUrl, parseSse } from '../src/api/http.js';

describe('redact', () => {
  it('masks registered secrets and key-like strings', () => {
    const r = new Redactor();
    r.add('my-super-secret-key-123');
    expect(r.redact('x my-super-secret-key-123 y')).toBe('x [REDACTED] y');
    expect(r.redact('Authorization: Bearer abcdefghijklmnop')).toContain('[REDACTED]');
    expect(r.redact('sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAA')).not.toContain('AAAAAAAAAAAAAAAAAAAAAAAA');
    expect(r.redactDeep({ headers: { 'x-api-key': 'zzz' }, a: ['my-super-secret-key-123'] })).toEqual({ headers: { 'x-api-key': '[REDACTED]' }, a: ['[REDACTED]'] });
  });
  it('hides hosts for sharing', () => {
    expect(maskHost('https://relay.example.com/v1')).toBe('https://•••/v1');
  });
});

describe('cli args', () => {
  it('parses flags', () => {
    const a = parseArgs(['http://x', '--model', 'm', '--samples=8', '--deep']);
    expect(a.positionals).toEqual(['http://x']);
    expect(a.flags).toEqual({ model: 'm', samples: '8', deep: true });
  });
  it('refuses keys on the command line', () => {
    expect(() => parseArgs(['http://x', '--key', 'sk-1'])).toThrow(/environment variable/);
    expect(() => parseArgs(['http://x', '--api-key=sk-1'])).toThrow(/environment variable/);
  });
  it('rejects unknown flags', () => {
    expect(() => parseArgs(['--wat'])).toThrow(/unknown option/);
  });
});

describe('helpers', () => {
  it('classifies free text answers', () => {
    const labels = ['red', 'blue', 'green'];
    expect(classify(labels, 'Blue.')).toBe('blue');
    expect(classify(labels, 'I pick green, not red')).toBe('green');
    expect(classify(labels, 'magenta')).toBe('other');
    expect(classify(['0', '1', '7'], '7')).toBe('7');
  });
  it('normalizes base urls', () => {
    expect(normalizeBaseUrl('https://a.com')).toBe('https://a.com/v1');
    expect(normalizeBaseUrl('https://a.com/v1/')).toBe('https://a.com/v1');
    expect(normalizeBaseUrl('https://a.com/api')).toBe('https://a.com/api/v1');
  });
  it('matches echoed model names', () => {
    expect(modelEchoMatches('claude-sonnet-4-5', 'claude-sonnet-4-5-20250929')).toBe(true);
    expect(modelEchoMatches('gpt-4o', 'gpt-4o-mini')).toBe(true);
    expect(modelEchoMatches('claude-opus-4', 'claude-3-haiku')).toBe(false);
  });
  it('parses SSE', () => {
    const ev = parseSse('event: a\ndata: {"x":1}\n\n: comment\n\ndata: [DONE]\n\n');
    expect(ev).toEqual([{ event: 'a', data: '{"x":1}' }, { event: null, data: '[DONE]' }]);
  });
});
