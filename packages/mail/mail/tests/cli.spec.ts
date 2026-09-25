import { afterEach, describe, expect, it } from 'vitest'
import { readFile, rm } from 'node:fs/promises'
import { completionScript, helpText, parseArgv, runCli, EXIT_OK, EXIT_REFUSED, EXIT_USAGE } from '../src/cli.ts'
import { tempHome, testConfig } from './helpers.ts'

const homes: string[] = []
afterEach(async () => { await Promise.all(homes.splice(0).map(home => rm(home, { recursive: true, force: true }))) })

/**
 * Run the CLI with captured output.
 * @param argv - arguments.
 * @param config - injected configuration.
 * @returns exit code and output.
 */
async function run(argv: string[], config: ReturnType<typeof testConfig>): Promise<{ code: number; out: string; err: string }> {
  const out: string[] = []
  const err: string[] = []
  const code = await runCli(argv, { out: (line) => { out.push(line) }, err: (line) => { err.push(line) } }, { config })
  return { code, out: out.join(''), err: err.join('') }
}

describe('cli', () => {
  it('parses repeatable and single flags', () => {
    const parsed = parseArgv(['--to', 'a@b.test', '--to=c@d.test', '--subject', 'hi'])
    expect('flags' in parsed).toBe(true)
    if (!('flags' in parsed)) return
    expect(parsed.flags.get('to')).toEqual(['a@b.test', 'c@d.test'])
    expect(parsed.command).toBe('send')
    expect('error' in parseArgv(['--subject', 'a', '--subject', 'b'])).toBe(true)
  })

  it('documents the exit codes and ships completions', () => {
    const help = helpText()
    expect(help).toContain('--dry-run')
    expect(help).toContain('--completion')
    expect(completionScript('bash')).toBeDefined()
    expect(completionScript('zsh')).toBeDefined()
    expect(completionScript('fish')).toBeUndefined()
  })

  it('prints a dry run as JSON and exits 0', async () => {
    const home = await tempHome(); homes.push(home)
    const result = await run(['send', '--to', 'test@example.com', '--subject', 'hi', '--body', 'x', '--dry-run', '--json'], testConfig(home))
    expect(result.code).toBe(EXIT_OK)
    const parsed = JSON.parse(result.out) as { ok: boolean; dryRun: boolean; recipients: string[] }
    expect(parsed.ok).toBe(true)
    expect(parsed.dryRun).toBe(true)
    expect(parsed.recipients).toEqual(['test@example.com'])
  })

  it('refuses a bad address with exit 2 and a JSON error', async () => {
    const home = await tempHome(); homes.push(home)
    const result = await run(['send', '--to', 'not-an-address', '--subject', 'hi', '--body', 'x', '--json'], testConfig(home))
    expect(result.code).toBe(EXIT_REFUSED)
    const parsed = JSON.parse(result.err) as { ok: boolean; error: { code: string } }
    expect(parsed.ok).toBe(false)
    expect(parsed.error.code).toBe('recipients')
  })

  it('reports an unknown command as usage error', async () => {
    const home = await tempHome(); homes.push(home)
    const result = await run(['explode'], testConfig(home))
    expect(result.code).toBe(EXIT_USAGE)
  })

  it('writes a template preview to a file', async () => {
    const home = await tempHome(); homes.push(home)
    const file = `${home}/preview.html`
    const result = await run([
      'preview', '--template', 'invite', '--locale', 'ru', '--out', file, '--style',
      '--var', 'name=Тимур', '--var', 'expiresMinutes=10', '--var', 'link=https://family.test/i',
    ], testConfig(home))
    expect(result.code).toBe(EXIT_OK)
    const html = await readFile(file, 'utf8')
    expect(html).toContain('<html')
    expect(html).toContain('Тимур')
  })

  it('reports the send log through status --json', async () => {
    const home = await tempHome(); homes.push(home)
    const config = testConfig(home)
    await run(['send', '--to', 'a@b.test', '--subject', 'logged', '--body', 'x'], config)
    const result = await run(['status', '--json'], config)
    expect(result.code).toBe(EXIT_OK)
    const parsed = JSON.parse(result.out) as { ok: boolean; summary: { total: number } }
    expect(parsed.ok).toBe(true)
    expect(parsed.summary.total).toBeGreaterThan(0)
  })
})
