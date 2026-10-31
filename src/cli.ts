import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { API_KINDS, type ApiKind } from './api/types.js';
import { createAdapter } from './api/detect.js';
import { findRef, generateFingerprint, loadRef, measureBillingBaseline, saveRef, type RefFingerprint } from './fingerprint.js';
import { IDENTITY_PROBES, refCompatibility } from './probes/identity.js';
import { MOCK_KINDS, type MockKind, startMock } from './mock/server.js';
import { Redactor, hostOf } from './redact.js';
import { cardStyleOf, renderCard } from './report/card.js';
import { renderHtml } from './report/html.js';
import { renderJson } from './report/json.js';
import { renderTerminal, useColor } from './report/terminal.js';
import { connect, meter, runCheck } from './run.js';
import { ALL_GROUPS, type GroupId, type Lang, RuntimeError } from './types.js';
import { VERSION } from './version.js';

export interface IO {
  stdout: (s: string) => void;
  stderr: (s: string) => void;
  env: NodeJS.ProcessEnv;
  isTTY: boolean;
  cwd: string;
}

export const defaultIO = (): IO => ({
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
  env: process.env,
  isTTY: !!process.stdout.isTTY,
  cwd: process.cwd(),
});

const BOOLEAN_FLAGS = new Set(['deep', 'show-host', 'no-color', 'quiet', 'help', 'version']);
const VALUE_FLAGS = new Set([
  'model', 'api', 'key-env', 'samples', 'probes', 'lang', 'json', 'html', 'card', 'ref', 'out', 'kind', 'port', 'host',
  'seed', 'concurrency', 'timeout', 'retries', 'reasoning-effort', 'inject-tokens', 'truncate-tokens',
]);
const FORBIDDEN = new Set(['key', 'api-key', 'apikey', 'token']);

export interface ParsedArgs {
  positionals: string[];
  flags: Record<string, string | boolean>;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const positionals: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') {
      positionals.push(...argv.slice(i + 1));
      break;
    }
    if (a === '-h') {
      flags.help = true;
      continue;
    }
    if (a === '-v') {
      flags.version = true;
      continue;
    }
    if (!a.startsWith('--')) {
      positionals.push(a);
      continue;
    }
    const eq = a.indexOf('=');
    const name = (eq >= 0 ? a.slice(2, eq) : a.slice(2)).toLowerCase();
    if (FORBIDDEN.has(name))
      throw new RuntimeError(`--${name} is not accepted: keys are read only from an environment variable (default RELAY_KEY, change with --key-env NAME)`);
    if (BOOLEAN_FLAGS.has(name)) {
      if (eq >= 0) throw new RuntimeError(`--${name} takes no value`);
      flags[name] = true;
    } else if (VALUE_FLAGS.has(name)) {
      const v = eq >= 0 ? a.slice(eq + 1) : argv[++i];
      if (v === undefined || (eq < 0 && v.startsWith('--'))) throw new RuntimeError(`--${name} requires a value`);
      flags[name] = v;
    } else throw new RuntimeError(`unknown option --${name} (see --help)`);
  }
  return { positionals, flags };
}

export const HELP = `relaycheck v${VERSION} — 验货：验证 LLM 中转站/代理/网关是否真的在提供你付费的模型
Verify that an LLM relay / proxy / gateway really serves the model you pay for.

Usage:
  relaycheck <base_url> --model <name> [options]
  relaycheck fingerprint <base_url> --model <name> --out refs/<model>.json [--samples 100]   (use a TRUSTED endpoint)
  relaycheck mock --kind honest|swap|inject|truncate [--port 8787] [--seed 42]

Options:
  --model <name>           model to request (required)
  --api <kind>             anthropic | openai | responses | auto (default auto)
  --key-env <VAR>          env var holding the API key (default RELAY_KEY). Keys are never accepted on the command line.
  --samples <n>            samples per identity probe, temperature=1 (default 24)
  --probes <list>          all | identity,protocol,billing,context (default all)
  --ref <file>             reference fingerprint (default: refs/<model>.json if present)
  --lang zh|en             report language (default from $LANG)
  --json <file>            write machine-readable JSON report (with raw evidence)
  --html <file>            write HTML report
  --card <file>            write 1200x630 SVG report card (host hidden unless --show-host)
  --show-host              show the relay host name in HTML/card
  --deep                   also run the 100k-token context probe (costs ~100k input tokens)
  --concurrency <n>        parallel requests (default 4)
  --timeout <sec>          per-request timeout (default 120)
  --retries <n>            retries on 429/5xx/network errors, honouring Retry-After (default 3)
  --reasoning-effort <e>   for OpenAI reasoning models (gpt-5, o-series): e.g. minimal, low, none
  --seed <n>               seed for Monte Carlo p-values (default 1)
  --no-color, --quiet      plain output / no progress lines (NO_COLOR is respected)

Exit codes: 0 consistent · 1 inconsistent · 2 inconclusive · 3 runtime error
`;

function int(v: string | boolean | undefined, name: string, def: number, min = 1): number {
  if (v === undefined) return def;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min) throw new RuntimeError(`--${name} must be an integer >= ${min}`);
  return n;
}

function str(v: string | boolean | undefined): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

function langOf(v: string | undefined, env: NodeJS.ProcessEnv): Lang {
  if (v === 'zh' || v === 'en') return v;
  if (v) throw new RuntimeError('--lang must be zh or en');
  return /^zh/i.test(env.LC_ALL || env.LC_MESSAGES || env.LANG || '') ? 'zh' : 'en';
}

function apiOf(v: string | undefined): ApiKind | 'auto' {
  if (!v || v === 'auto') return 'auto';
  if ((API_KINDS as string[]).includes(v)) return v as ApiKind;
  throw new RuntimeError('--api must be anthropic, openai, responses or auto');
}

function probesOf(v: string | undefined): GroupId[] {
  if (!v || v === 'all') return [...ALL_GROUPS];
  const list = v.split(',').map((s) => s.trim()).filter(Boolean);
  for (const p of list) if (!(ALL_GROUPS as string[]).includes(p)) throw new RuntimeError(`unknown probe group "${p}"`);
  return ALL_GROUPS.filter((g) => list.includes(g));
}

function readKey(flags: ParsedArgs['flags'], env: NodeJS.ProcessEnv, baseUrl: string): { key: string; envName: string } {
  const envName = str(flags['key-env']) ?? 'RELAY_KEY';
  const key = env[envName] ?? '';
  if (!key) {
    const h = hostOf(baseUrl).replace(/:\d+$/, '');
    if (!['localhost', '127.0.0.1', '[::1]'].includes(h))
      throw new RuntimeError(`no API key: set the ${envName} environment variable (e.g. export ${envName}=sk-...)`);
  }
  return { key, envName };
}

function writeOut(path: string, content: string, io: IO): string {
  const p = resolve(io.cwd, path);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, content);
  return p;
}

export async function main(argv: string[], io: IO = defaultIO()): Promise<number> {
  const redactor = new Redactor();
  const err = (s: string) => io.stderr(redactor.redact(s));
  try {
    const { positionals, flags } = parseArgs(argv);
    if (flags.version) {
      io.stdout(`${VERSION}\n`);
      return 0;
    }
    if (flags.help || positionals.length === 0) {
      io.stdout(HELP);
      return positionals.length === 0 && !flags.help ? 3 : 0;
    }
    const cmd = positionals[0];
    const quiet = !!flags.quiet;
    const log = (m: string) => {
      if (!quiet) err(`  · ${m}\n`);
    };

    if (cmd === 'mock') {
      const kind = (str(flags.kind) ?? 'honest') as MockKind;
      if (!MOCK_KINDS.includes(kind)) throw new RuntimeError(`--kind must be one of ${MOCK_KINDS.join('|')}`);
      const h = await startMock({
        kind,
        port: int(flags.port, 'port', 8787, 0),
        host: str(flags.host) ?? '127.0.0.1',
        seed: int(flags.seed, 'seed', 42, 0),
        injectTokens: int(flags['inject-tokens'], 'inject-tokens', 512, 0),
        truncateTokens: int(flags['truncate-tokens'], 'truncate-tokens', 8000, 1),
      });
      io.stdout(`relaycheck mock (${kind}) listening on ${h.url}  — Anthropic: ${h.url}/v1/messages  OpenAI: ${h.url}/v1/chat/completions, ${h.url}/v1/responses\n`);
      await new Promise<void>((res) => {
        const stop = () => res();
        process.once('SIGINT', stop);
        process.once('SIGTERM', stop);
      });
      await h.close();
      return 0;
    }

    const isFingerprint = cmd === 'fingerprint';
    const rest = cmd === 'check' || isFingerprint ? positionals.slice(1) : positionals;
    const baseUrl = rest[0];
    if (!baseUrl) throw new RuntimeError('missing <base_url>');
    if (rest.length > 1) throw new RuntimeError(`unexpected argument "${rest[1]}"`);
    const model = str(flags.model);
    if (!model) throw new RuntimeError('missing --model <name>');
    const { key } = readKey(flags, io.env, baseUrl);
    redactor.add(key);
    const api = apiOf(str(flags.api));
    const timeoutMs = int(flags.timeout, 'timeout', 120) * 1000;
    const concurrency = int(flags.concurrency, 'concurrency', 4);
    const reasoningEffort = str(flags['reasoning-effort']);
    const retries = int(flags.retries, 'retries', 3, 0);

    if (isFingerprint) {
      const out = str(flags.out);
      if (!out) throw new RuntimeError('fingerprint needs --out refs/<model>.json');
      const samples = int(flags.samples, 'samples', 100, 2);
      const conn = await connect({ baseUrl, api, key, timeoutMs, model, log, reasoningEffort, retries });
      const normBase = conn.baseUrl;
      const { adapter, usage } = meter(conn.adapter);
      log(`sampling ${samples} × ${IDENTITY_PROBES.length} probes (≈${samples * IDENTITY_PROBES.length} short requests)`);
      const ref = await generateFingerprint(adapter, model, samples, concurrency, log, IDENTITY_PROBES, reasoningEffort);
      // exact billing baselines for the billing check; OpenAI endpoints get both protocols
      ref.billing = {};
      const kinds: ApiKind[] = adapter.kind === 'anthropic' ? ['anthropic'] : [adapter.kind, adapter.kind === 'openai' ? 'responses' : 'openai'];
      for (const k of kinds) {
        try {
          const a = k === adapter.kind ? adapter : meter(createAdapter(k, { baseUrl: normBase, key, timeoutMs, retries, reasoningEffort }), usage).adapter;
          ref.billing[k] = await measureBillingBaseline(a, model);
          log(`billing baseline (${k}): ${ref.billing[k].prompts.map((p) => `${p.id}=${p.inputTokens}`).join(' ')}`);
        } catch (e) {
          log(`billing baseline (${k}) skipped: ${(e as Error).message.slice(0, 160)}`);
        }
      }
      const path = resolve(io.cwd, out);
      saveRef(path, ref);
      io.stdout(`wrote reference fingerprint ${path} (probe set v${ref.probeSetVersion}: ${ref.probes.length} probes × ${samples}; billing baselines: ${Object.keys(ref.billing).join(', ') || 'none'}; used ${usage.requests} requests, ${usage.inputTokens} input / ${usage.outputTokens} output tokens)\n`);
      return 0;
    }

    const lang = langOf(str(flags.lang), io.env);
    let refPath = str(flags.ref) ? resolve(io.cwd, str(flags.ref)!) : findRef(model, io.cwd);
    let ref: RefFingerprint | null = null;
    if (refPath) {
      try {
        ref = loadRef(refPath);
      } catch (e) {
        throw new RuntimeError(`cannot load --ref: ${(e as Error).message}`);
      }
      try {
        refCompatibility(ref, { api: 'unknown' }); // fail fast on unknown probe sets / edited prompts
      } catch (e) {
        throw new RuntimeError(`cannot use --ref ${refPath}: ${(e as Error).message}`);
      }
      if (ref.model !== model) log(`note: reference is for "${ref.model}", testing "${model}"`);
    } else refPath = null;
    const probes = probesOf(str(flags.probes));
    if (probes.includes('context')) log(`context probe sends ≈34k input tokens${flags.deep ? ' + ≈100k (--deep)' : ''}`);
    const report = await runCheck({
      baseUrl,
      model,
      api,
      key,
      samples: int(flags.samples, 'samples', 24, 2),
      probes,
      ref,
      refPath,
      deep: !!flags.deep,
      concurrency,
      timeoutMs,
      retries,
      reasoningEffort,
      seed: int(flags.seed, 'seed', 1, 0),
      log,
    });
    const color = useColor(io.env, io.isTTY, !!flags['no-color']);
    io.stdout(redactor.redact(renderTerminal(redactor.redactDeep(report), lang, color)));
    const showHost = !!flags['show-host'];
    const wrote: string[] = [];
    if (str(flags.json)) wrote.push(writeOut(str(flags.json)!, renderJson(report, redactor), io));
    if (str(flags.html)) wrote.push(writeOut(str(flags.html)!, redactor.redact(renderHtml(redactor.redactDeep(report), lang, showHost)), io));
    if (str(flags.card)) wrote.push(writeOut(str(flags.card)!, redactor.redact(renderCard(redactor.redactDeep(report), { showHost, lang, style: cardStyleOf(io.env.RELAYCHECK_CARD_STYLE) })), io));
    for (const w of wrote) log(`wrote ${w}`);
    return report.exitCode;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    err(`relaycheck: error: ${msg}\n`);
    return 3;
  }
}
