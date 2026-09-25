import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  DEFAULT_TARGET,
  KNOWN_PRE_PATCH_SHAS,
  ORIGINAL_TEXT,
  applyPatch,
  countOccurrences,
  detectState,
  revertPatch,
  sha256,
} from './patch-bili-restore.mjs'

interface StepResult {
  parsed: Record<string, unknown>
  logs: string[]
  metadata: Record<string, unknown>
}

const here = import.meta.dirname
const patcher = resolve(here, 'patch-bili-restore.mjs')
const tmp = mkdtempSync(join(tmpdir(), 'bili-restore-spec-'))

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true })
})

// Minimal stand-ins for the three billion-context helpers the restored function
// calls. They mirror dist/index.js (same field order, same write semantics), so
// the harness exercises the real algorithm without an installed bili copy.
const STUBS = [
  'const SIDE_REQUEST_MAX_TOKENS = 200;',
  'function outputBudgetField(parsed) {',
  '  for (const field of ["max_tokens", "max_completion_tokens", "max_output_tokens"]) {',
  '    if (typeof parsed[field] === "number" && parsed[field] > 0) return field;',
  '  }',
  '  return null;',
  '}',
  'function readOutputBudget(parsed, field) {',
  '  const value = parsed[field];',
  '  return typeof value === "number" ? value : void 0;',
  '}',
  'function writeOutputBudget(parsed, field, value) {',
  '  parsed[field] = value;',
  '}',
].join('\n')

function fixtureSource(): string {
  return STUBS + '\n' + ORIGINAL_TEXT + '\n'
}

function at<T>(items: T[], index: number): T {
  const value = items[index]
  if (value === undefined) throw new Error('missing step ' + index)
  return value
}

interface VariantInput {
  metadata: Record<string, unknown>
  steps: Record<string, unknown>[]
}

function variantSource(source: string, declared: Record<string, number>): string {
  return [
    "import { readFileSync } from 'node:fs'",
    'const LAUNCHER_MODEL_MAX_OUTPUTS = ' + JSON.stringify(declared),
    STUBS,
    source,
    "const input = JSON.parse(readFileSync(process.argv[2], 'utf8'))",
    "const session = { id: 's1', metadata: input.metadata }",
    'const results = []',
    'for (const step of input.steps) {',
    '  const logs = []',
    '  restoreOutputBudget(step, session, (level, message) => { logs.push(message) })',
    '  results.push({ parsed: step, logs, metadata: session.metadata })',
    '}',
    'process.stdout.write(JSON.stringify(results))',
  ].join('\n')
}

function runVariant(
  name: string,
  source: string,
  declared: Record<string, number>,
  steps: Record<string, unknown>[],
  metadata: Record<string, unknown> = {},
): StepResult[] {
  const runner = join(tmp, name + '.mjs')
  writeFileSync(runner, variantSource(source, declared), 'utf8')
  const inputFile = join(tmp, name + '.input.json')
  writeFileSync(inputFile, JSON.stringify({ metadata, steps } satisfies VariantInput), 'utf8')
  const res = spawnSync(process.execPath, [runner, inputFile], { encoding: 'utf8' })
  if (res.status !== 0) throw new Error(name + ' runner failed: ' + res.stderr)
  return JSON.parse(res.stdout) as StepResult[]
}

function patchedSource(): string {
  const applied = applyPatch(ORIGINAL_TEXT)
  if (!applied.ok) throw new Error(applied.reason)
  return applied.source
}

function cli(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const res = spawnSync(process.execPath, [patcher, ...args], { encoding: 'utf8' })
  return { status: res.status, stdout: res.stdout, stderr: res.stderr }
}

describe('restoreOutputBudget behaviour', () => {
  it('keeps the cross-provider leak on the unpatched function', () => {
    const results = runVariant('control', ORIGINAL_TEXT, {}, [
      { model: 'deepseek-flash', max_completion_tokens: 256000 },
      { model: 'mimo-v2.6-flash', max_completion_tokens: 1, tools: [{}] },
    ])
    expect(at(results, 0).metadata.outputBudgetHighWater).toBe(256000)
    expect(at(results, 1).parsed.max_completion_tokens).toBe(256000)
    expect(at(results, 1).logs[0]).toContain('output budget restored 1 -> 256000 (#546')
  })

  it('never restores another model budget when nothing is declared', () => {
    const results = runVariant('patched-empty', patchedSource(), {}, [
      { model: 'deepseek-flash', max_completion_tokens: 256000 },
      { model: 'mimo-v2.6-flash', max_completion_tokens: 1, tools: [{}] },
    ])
    expect(at(results, 1).parsed.max_completion_tokens).toBe(1)
    expect(at(results, 1).logs).toEqual([])
    const byModel = at(results, 1).metadata.outputBudgetHighWaterByModel as Record<string, number>
    expect(byModel['deepseek-flash']).toBe(256000)
    expect(byModel['mimo-v2.6-flash']).toBeUndefined()
  })

  it('restores each route to its own declared budget', () => {
    const results = runVariant('patched-declared', patchedSource(), { 'deepseek-flash': 256000, 'mimo-v2.6-flash': 131072 }, [
      { model: 'deepseek-flash', max_completion_tokens: 256000 },
      { model: 'mimo-v2.6-flash', max_completion_tokens: 1, tools: [{}] },
      { model: 'mimo-v2.6-flash', max_completion_tokens: 131072 },
      { model: 'deepseek-flash', max_completion_tokens: 1, tools: [{}] },
    ])
    expect(at(results, 1).parsed.max_completion_tokens).toBe(131072)
    expect(at(results, 1).logs[0]).toContain('output budget restored 1 -> 131072 (#546: declared max output)')
    expect(at(results, 2).metadata.outputBudgetHighWater).toBe(131072)
    expect(at(results, 3).parsed.max_completion_tokens).toBe(256000)
    expect(at(results, 3).logs[0]).toContain('output budget restored 1 -> 256000 (#546: model high-water)')
  })

  it('clamps a learned model budget down to its declared max', () => {
    const results = runVariant('patched-clamp', patchedSource(), { m: 131072 }, [
      { model: 'm', max_completion_tokens: 262144 },
      { model: 'm', max_completion_tokens: 1, tools: [{}] },
    ])
    expect(at(results, 1).parsed.max_completion_tokens).toBe(131072)
    expect(at(results, 1).logs[0]).toContain('(clamped from 262144 to the declared max output of m)')
  })

  it('restores a small in-route high-water and leaves a tool-less request alone', () => {
    const results = runVariant('patched-small', patchedSource(), { m: 131072 }, [
      { model: 'm', max_completion_tokens: 320 },
      { model: 'm', max_completion_tokens: 1, tools: [{}] },
      { model: 'm', max_completion_tokens: 1 },
    ])
    expect(at(results, 1).parsed.max_completion_tokens).toBe(320)
    expect(at(results, 2).parsed.max_completion_tokens).toBe(1)
    expect(at(results, 2).logs).toEqual([])
  })

  it('falls back to the legacy session high-water only when no model is named', () => {
    const results = runVariant('patched-legacy', patchedSource(), {}, [
      { max_completion_tokens: 1, tools: [{}] },
    ], { outputBudgetHighWater: 256000 })
    expect(at(results, 0).parsed.max_completion_tokens).toBe(256000)
    expect(at(results, 0).logs[0]).toContain('(#546: session high-water)')
  })
})

describe('patcher mechanics', () => {
  it('round-trips a fixture and is idempotent', () => {
    const fixture = fixtureSource()
    expect(countOccurrences(fixture, 'function restoreOutputBudget(')).toBe(1)
    expect(detectState(fixture).state).toBe('original')
    const applied = applyPatch(fixture)
    if (!applied.ok) throw new Error(applied.reason)
    expect(applied.changed).toBe(true)
    expect(detectState(applied.source).state).toBe('patched')
    expect(countOccurrences(applied.source, 'function launcherModelMaxOutput(')).toBe(1)
    const again = applyPatch(applied.source)
    if (!again.ok) throw new Error(again.reason)
    expect(again.changed).toBe(false)
    expect(again.source).toBe(applied.source)
    const reverted = revertPatch(applied.source)
    if (!reverted.ok) throw new Error(reverted.reason)
    expect(reverted.source).toBe(fixture)
    const already = revertPatch(fixture)
    if (!already.ok) throw new Error(already.reason)
    expect(already.changed).toBe(false)
    expect(already.source).toBe(fixture)
  })

  it('reports a missing anchor instead of guessing', () => {
    const broken = 'function somethingElse() {}'
    expect(detectState(broken).state).toBe('missing')
    expect(applyPatch(broken).ok).toBe(false)
    expect(revertPatch(broken).ok).toBe(false)
  })

  it('applies, re-applies without touching bytes, and reverts through the CLI', () => {
    const target = join(tmp, 'cli-target.mjs')
    const original = fixtureSource()
    writeFileSync(target, original, 'utf8')
    const check = cli(['--check', '--file', target])
    expect(check.status).toBe(0)
    expect(check.stdout).toContain('anchor hits (function restoreOutputBudget): 1')
    expect(check.stdout).toContain('verdict: READY-TO-PATCH')
    const apply = cli(['--apply', '--allow-unknown-origin', '--file', target])
    expect(apply.status).toBe(0)
    const patched = readFileSync(target, 'utf8')
    expect(detectState(patched).state).toBe('patched')
    const second = cli(['--apply', '--allow-unknown-origin', '--file', target])
    expect(second.status).toBe(0)
    expect(second.stdout).toContain('already patched; file left byte-identical')
    expect(readFileSync(target, 'utf8')).toBe(patched)
    const recheck = cli(['--check', '--file', target])
    expect(recheck.stdout).toContain('verdict: ALREADY-PATCHED')
    const revert = cli(['--revert', '--file', target])
    expect(revert.status).toBe(0)
    expect(readFileSync(target, 'utf8')).toBe(original)
  })

  it('refuses an unknown build unless --allow-unknown-origin is passed', () => {
    const target = join(tmp, 'cli-unknown-origin.mjs')
    const original = fixtureSource()
    writeFileSync(target, original, 'utf8')
    const refused = cli(['--apply', '--file', target])
    expect(refused.status).toBe(1)
    expect(refused.stderr).toContain('not a known pre-patch billion-context dist')
    expect(readFileSync(target, 'utf8')).toBe(original)
    const forced = cli(['--apply', '--allow-unknown-origin', '--file', target])
    expect(forced.status).toBe(0)
    expect(detectState(readFileSync(target, 'utf8')).state).toBe('patched')
    const reApplied = cli(['--apply', '--file', target])
    expect(reApplied.status).toBe(0)
    expect(reApplied.stdout).toContain('already patched; file left byte-identical')
  })

  it('exits non-zero when the anchor is absent', () => {
    const target = join(tmp, 'cli-missing.mjs')
    writeFileSync(target, 'const unrelated = 1;\n', 'utf8')
    const check = cli(['--check', '--file', target])
    expect(check.status).toBe(1)
    expect(check.stdout).toContain('verdict: ANCHORS-MISSING')
    const apply = cli(['--apply', '--file', target])
    expect(apply.status).toBe(1)
    expect(apply.stderr).toContain('REFUSED')
    expect(readFileSync(target, 'utf8')).toBe('const unrelated = 1;\n')
  })
})

describe.skipIf(!existsSync(DEFAULT_TARGET))('installed billion-context dist', () => {
  it('keeps the restore anchor unique and in a known state', () => {
    const source = readFileSync(DEFAULT_TARGET, 'utf8')
    expect(countOccurrences(source, 'function restoreOutputBudget(')).toBe(1)
    expect(detectState(source).state).not.toBe('missing')
    // The deployed dist is either untouched-known or already patched; anything else
    // means --apply would refuse until a human re-verifies the new build.
    expect(detectState(source).state === 'patched' || KNOWN_PRE_PATCH_SHAS.has(sha256(source))).toBe(true)
  })
})
